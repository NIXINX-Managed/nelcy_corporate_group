FROM python:3.12-slim
WORKDIR /app
COPY server.py ./
USER 65532
ENV PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
