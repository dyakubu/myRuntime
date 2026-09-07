import os

# Must be set before app.main (and its routers) are imported anywhere in the test
# session, since each router builds its runner once at import time.
os.environ.setdefault("RUNNER_BACKEND", "local")
