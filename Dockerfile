# Pipeline image for machines where pyvroom has no native wheel
# (Intel Macs, macOS < 15, older Linux). See PLAN.md §3.2.
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY config ./config
COPY pipeline ./pipeline
CMD ["python", "-m", "pipeline.check_env"]
