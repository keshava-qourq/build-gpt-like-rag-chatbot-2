"""Provider adapters named by the architecture: generation and embeddings.

Each is a single interface with a swappable default implementation, so
changing provider is a config change rather than a rewrite of every handler
that generates an answer or embeds a chunk.
"""
