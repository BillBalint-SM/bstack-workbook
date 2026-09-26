# Sources and licenses

BontaFlowStack's Windows/Codex workflows derive from [garrytan/gstack](https://github.com/garrytan/gstack). The pinned behavioral source revision is `71f6048e8ada25180e61438abc1d98cb151fe9a7`. The local source revision used for the Windows/Codex port is `5fcee0c4e7913ce5ace55ad450aab4ae20482f4b`.

The provenance records keep the original source paths and hashes alongside the BontaFlowStack destinations. Their destination hashes describe the recorded adoption snapshots; maintained files on `main` can differ:

- [Workflow adoption](workflow-adoption.json)
- [Shared runtime adoption](common-adoption.json)
- [Browser and design adoption](browser-adoption.json)
- [Helper adoption](helper-adoption.json)

Four shared helpers also came from a local reference of the [BontaFlowStack workbook](https://github.com/BillBalint-SM/bontaflowstack-workbook), identified locally as `349cad6e655479baee84012131d2a34a4849f46b`. [`helper-adoption.json`](helper-adoption.json) records their original paths and SHA-256 values. That local revision ID does not establish that the commit is available on GitHub.

The package includes the [MIT license](../plugins/bontaflowstack/licenses/MIT.txt), the [Apache-2.0 license](../plugins/bontaflowstack/licenses/Apache-2.0.txt), and [third-party notices](../plugins/bontaflowstack/licenses/upstream-NOTICE.md). Historical paths in the notices and the `source` fields identify where material came from. Packaged paths are recorded under `destination`.

The plugin's operational names are `bontaflowstack` and `bfstack`. Older names in these records identify upstream material and are not package commands.
