import json
import logging
import sys

logger = logging.getLogger("myruntime")
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler(sys.stdout)
_handler.setFormatter(logging.Formatter("%(message)s"))
logger.addHandler(_handler)
logger.propagate = False


def log_metric(metric: str, **fields) -> None:
    """Emit one structured JSON line. Cloud Run ships stdout to Cloud Logging automatically;
    log-based metrics derive the counters/distributions from these — see
    docs/myruntime-v0-spec.md §7."""
    logger.info(json.dumps({"metric": metric, **fields}))
