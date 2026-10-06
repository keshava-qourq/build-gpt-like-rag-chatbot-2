"""One router module per architecture component that owns api_spec endpoints.

`app.main` includes each of these; every route here is a stub that validates
its request shape and returns a typed placeholder, so the service starts,
serves its OpenAPI document and has an import path for the next ticket's
handler to replace, one route at a time.
"""
