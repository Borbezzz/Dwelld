# Historical observation search investigation

Checked 23 October 2026 against the configured Atlas database. This included read-only capability inspection followed by reversible temporary-index probes. Existing indexes and application routes were preserved.

## Observed on the actual cluster

- MongoDB server version: **8.0.34**.
- `findings_search`: type `search`, **READY**, queryable. Its existing explicit mappings cover labels, descriptions, finding kind, review status, room and inspection identifiers.
- No vector index is configured on `findings`.
- At inspection time the collection contained zero findings, so there was no retained historical corpus to evaluate for relevance.
- An actual `$vectorSearch` aggregation with a deliberately absent index was accepted and returned zero results. This establishes stage availability only; it does **not** establish a functioning vector index or semantic retrieval.
- An actual `$rankFusion` aggregation combining two empty, sorted selection pipelines was accepted. This establishes stage availability only; it does **not** establish hybrid text/vector relevance.

Existing `GET /api/search` remains Atlas lexical search over label and description, optionally filtered to a room. Its label boost and fuzzy matching are useful for object names and damage keywords. Preserve this endpoint and index while adding semantic retrieval separately.

## Automated Embedding feasibility

MongoDB currently documents Atlas Automated Embedding as **Public Preview**, with `autoEmbed` index fields and Voyage models managed within Atlas. This can avoid a separate embedding service and application API key. MongoDB warns against production use of the preview. Dedicated M10+ clusters require storage auto-scaling; model documentation also describes M0 and Flex quotas. Cluster tier and billing/quota configuration were not inspected through the Atlas control plane. Actual provisioning attempts are recorded below. [Automated Embedding overview](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/), [models and quotas](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/).

Native `$rankFusion` is documented for MongoDB 8.0+, consistent with the live stage probe. Combining bounded lexical and vector results using reciprocal ranks avoids directly comparing incompatible raw scores. [Hybrid Search](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/).

## Temporary provisioning probes and cleanup

- Atlas accepted a temporary `autoEmbed` index on three non-sensitive synthetic descriptions (chair upholstery tear, chipped table edge, wall stain). It did not become queryable during approximately 60 seconds of polling. This timeout does not prove that Automated Embedding is unsupported. The temporary collection was removed.
- A subsequent attempt to create both an automated vector index and a lexical index for a genuine hybrid query was rejected with MongoDB error **20**: “The maximum number of FTS indexes has been reached for this instance size.” Pending index deletion may have contributed; the actual tier/quota was not changed.
- A final single-index retry had already started when further provisioning was stopped. It was still `PENDING` and not queryable; its process was stopped and its temporary collection removed explicitly.
- Cleanup query confirmed **zero** collections matching the temporary probe prefix. `findings_search` remained **READY** and queryable.
- No semantic ranking query or genuine hybrid text/vector result was obtained. No synthetic findings were added to the application's `findings` collection. There is no vector integration to claim for the demo.

## Concrete next step after the core inspection passes

1. In a temporary collection, use a few non-sensitive descriptions from verified inspection observations and an `autoEmbed` index using `voyage-4-lite`. Include room and review-status filter fields. Wait for the index to become queryable; report provisioning errors without claiming support.
2. Query semantically different wording (for example, “seat fabric ripped” against an actual “tear in chair upholstery” observation), then combine that vector query with Atlas lexical search through `$rankFusion`. Check the expected observation ranks ahead of unrelated damage, and remove the temporary collection/index afterward.
3. If the real probe passes, add a stable search-text field combining object label, damage type and description to saved findings. Keep model-suggested, confirmed and rejected observations distinguishable; omit rejected findings by default and expose review status with every result.
4. Add an explicit historical-observations search mode that filters to the current room and previous completed inspections. Return the saved inspection, evidence timestamp and finding link. Semantic similarity must not automatically claim that two observations depict the same physical object or damage.
5. Keep lexical search available when preview embedding services are unavailable, and label the mode used in responses. Do not call lexical-only results hybrid results.

No semantic feature is marked implemented or tested yet. The present controlled demo has no tenant authentication: room scoping is product filtering, not tenant-level authorization.
