import json
import logging
import sys

logger = logging.getLogger("myruntime")
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(logging.Formatter("%(message)s"))
logger.addHandler(_handler)
logger.propagate = False


_LEVELS = {"info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}


def log_metric(metric: str, *, level: str = "info", **fields) -> None:
    """Emit one structured JSON line. Cloud Run ships stdout to Cloud Logging automatically;
    log-based metrics derive the counters/distributions from these — see
    docs/myruntime-v0-spec.md §7.

    `level` sets both the Python log level (for local dev output) and a top-level
    "severity" key in the JSON payload — Cloud Logging promotes structured stdout/stderr
    lines to that severity, so passing level="error" here is what makes a real failure
    filterable (e.g. `severity>=ERROR`) instead of blending into routine INFO traffic.
    """
    logger.log(_LEVELS[level], json.dumps({"metric": metric, "severity": level.upper(), **fields}))
