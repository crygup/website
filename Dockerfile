FROM python:3.13.5-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --create-home --uid 10001 website
WORKDIR /app

FROM base AS static

COPY --chown=website:website src/ /app/
RUN mkdir -p /app/logs \
    && chmod -R a=rX /app

USER website
EXPOSE 8080
CMD ["python", "serve.py", "8080"]

FROM base AS avatar-api

RUN apt-get update \
    && apt-get install --yes --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

COPY src/server/requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /app/requirements.txt

COPY --chown=website:website src/server/avatar_api.py src/server/logging_utils.py /app/
RUN mkdir -p /app/logs \
    && chmod -R a=rX /app

USER website
EXPOSE 8000
CMD ["python", "avatar_api.py"]

FROM base AS download-api

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY src/server/download_requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /app/requirements.txt

COPY --chown=website:website src/server/download_api.py src/server/logging_utils.py /app/
RUN mkdir -p /app/downloads /app/logs \
    && chmod -R a=rX /app

USER website
EXPOSE 8002
CMD ["python", "download_api.py"]
