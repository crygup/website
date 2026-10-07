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

FROM base AS media-api

COPY src/server/media_requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /app/requirements.txt

COPY --chown=website:website src/server/media_api.py src/server/logging_utils.py /app/
RUN mkdir -p /app/media /app/logs \
    && chmod -R a=rX /app

USER website
EXPOSE 8003
CMD ["python", "media_api.py"]

FROM base AS rapi-api

COPY src/server/rapi_requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /app/requirements.txt

COPY --chown=website:website src/server/rapi_api.py src/server/logging_utils.py /app/
RUN mkdir -p /app/logs \
    && chmod -R a=rX /app

USER website
EXPOSE 8004
CMD ["python", "rapi_api.py"]

FROM base AS rodb-api

COPY src/server/rodb_requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir --requirement /app/requirements.txt

COPY --chown=website:website src/server/rodb_api.py src/server/logging_utils.py /app/
RUN mkdir -p /app/logs \
    && chmod -R a=rX /app

USER website
EXPOSE 8005
CMD ["python", "rodb_api.py"]
