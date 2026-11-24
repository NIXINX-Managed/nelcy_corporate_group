"""Apply scoped Corporate license decisions with the client's Cloud Run identity."""
import datetime as dt
import hmac
import json
import os
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONTROL = "https://controlde.nixinx.org/api/internal/entitlement-decision"
METADATA = "http://metadata.google.internal/computeMetadata/v1"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


opener = urllib.request.build_opener(NoRedirect())


def request(url, headers, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    with opener.open(req, timeout=5) as response:
        return json.load(response)


def renew():
    scope = {
        "hostname": os.environ["CORPORATE_HOSTNAME"],
        "tenantId": os.environ["CORPORATE_TENANT_ID"],
        "appId": "corporate",
        "environment": "production",
    }
    decision = request(CONTROL, {
        "Authorization": "Bearer " + os.environ["CONTROL_SERVICE_TOKEN"],
        "Content-Type": "application/json",
    }, scope)
    if any(decision.get(key) != value for key, value in scope.items()):
        raise ValueError("Decision scope mismatch")
    project, org = decision["firebaseProjectId"], decision["orgId"]
    if project != os.environ["CORPORATE_FIREBASE_PROJECT_ID"] or org != os.environ["CORPORATE_ORG_ID"]:
        raise ValueError("Firestore binding mismatch")
    if not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", project) or not re.fullmatch(r"[a-zA-Z0-9_-]{2,80}", org):
        raise ValueError("Invalid Firestore target")
    metadata = {"Metadata-Flavor": "Google"}
    with opener.open(urllib.request.Request(METADATA + "/project/project-id", headers=metadata), timeout=3) as response:
        if response.read().decode().strip() != project:
            raise ValueError("Writer must run inside the customer's project")
    now = dt.datetime.now(dt.timezone.utc)
    expiry = dt.datetime.fromisoformat(decision["expiresAt"].replace("Z", "+00:00"))
    allowed = decision.get("allowed") is True and now < expiry <= now + dt.timedelta(seconds=30)
    token = request(METADATA + "/instance/service-accounts/default/token", metadata)["access_token"]
    database = f"projects/{project}/databases/(default)"
    request(f"https://firestore.googleapis.com/v1/{database}/documents:commit", {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
    }, {"writes": [{"update": {
        "name": f"{database}/documents/organizations/{org}/nixinxControl/access",
        "fields": {
            "active": {"booleanValue": allowed},
            "appId": {"stringValue": "corporate"},
            "environment": {"stringValue": "production"},
            "expiresAt": {"timestampValue": (expiry if allowed else now).isoformat()},
        },
    }, "updateTransforms": [{"fieldPath": "updatedAt", "setToServerValue": "REQUEST_TIME"}]}]})
    return allowed


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        expected = os.environ.get("WRITER_SERVICE_TOKEN", "")
        incoming = self.headers.get("Authorization", "")
        if self.path != "/renew":
            return self.reply(404, False)
        if len(expected) < 32 or not hmac.compare_digest(incoming.encode(), ("Bearer " + expected).encode()):
            return self.reply(401, False)
        try:
            self.reply(200, renew())
        except Exception as exc:
            print(json.dumps({"event": "lease_write_failed", "type": type(exc).__name__, "httpStatus": getattr(exc, "code", None)}), flush=True)
            self.reply(503, False)

    def reply(self, status, allowed):
        payload = json.dumps({"allowed": allowed}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()
