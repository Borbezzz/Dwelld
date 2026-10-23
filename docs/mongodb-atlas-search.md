# MongoDB Atlas Search setup

Dwelld's observation search uses MongoDB Atlas Search. It does not fall back to a regular collection query when Atlas Search is unavailable. Configure a Search index on the `findings` collection before using the search endpoint.

## Create the index

In Atlas, open the target cluster, choose **Search & Vector Search**, create a Search index for the `findings` collection, select the JSON editor, and use:

- Database: the value of `MONGODB_DB` (or `dwelld` if unset)
- Collection: `findings`
- Index name: `findings_search`

Index definition:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "label": { "type": "string" },
      "description": { "type": "string" },
      "kind": { "type": "string" },
      "reviewStatus": { "type": "string" },
      "roomId": { "type": "objectId" },
      "inspectionId": { "type": "objectId" }
    }
  }
}
```

Wait for the index status to become **Ready**. Documents without a particular optional field can still be indexed. If the stored identifiers are strings rather than BSON ObjectIds in your deployment, change the corresponding mapping to `string` and ensure the query's filter representation matches the stored type.

## Search behavior

The application exposes `GET /api/search?q=...` with optional `roomId` and `limit` query parameters. A room filter is applied in Atlas Search. An empty `q` does not trigger a broad search. Results are findings (object and damage observations) from the `findings` collection; rooms and inspections are stored separately. Searchable text is in `label` and `description`; `kind` distinguishes object from damage findings. Search is unavailable until the Atlas index is ready, and the API reports the service error rather than claiming a normal MongoDB lookup is Atlas Search.

Atlas Vector Search and hybrid search are not configured by this index. They require a vector field, an embedding pipeline, and a compatible Vector Search index; they should only be described as available after those pieces are implemented and deployed.
