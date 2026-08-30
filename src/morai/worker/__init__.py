"""The background worker: a Procrastinate `App` on its own psycopg pool
(`app.py`), separate from the web process's asyncpg pool (D-13)."""
