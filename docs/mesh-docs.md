
// FILE: ARCHITECTURE.md
```md
# Mesh Architecture

## Overview

Mesh is a decentralized, peer-to-peer microservice framework for Node.js and the browser. Every node in a Mesh network is a full peer — there are no dedicated routers, gateways, or master nodes. Services register tools (RPC endpoints) and events, which are automatically discoverable by any connected peer through gossip-based registry synchronization.

A Mesh node is composed of four core systems, each managed as a pluggable module:

| System | Module | Provider Key | Purpose |
|---|---|---|---|
| Registry | `RegistryModule` | `registry` | Tracks all known nodes, their services, and their tools |
| Network | `NetworkModule` | `network` | WebSocket transport, packet routing, deduplication |
| Database | `DatabaseModule` | `database` | MongoDB connection, CRUD/TS middleware interception |
| Broker | `BrokerModule` | `broker` | RPC dispatch, middleware pipelines, event bus |

---

## MeshApp

[MeshApp.ts](file:///home/ubuntu/code/mesh/src/core/MeshApp.ts) is the application container. It owns the module lifecycle, a dependency injection (DI) provider registry, and delegates boot sequencing to `BootOrchestrator`.

### Provider Registry (DI)

`MeshApp` maintains a `Map<string, unknown>` of named providers. Modules register themselves during `onInit`:

```typescript
// Inside RegistryModule.onInit:
app.registerProvider('registry', this.registry);

// Inside NetworkModule.onInit:
app.registerProvider('network', this.network);

// Inside BrokerModule.onInit:
app.registerProvider('broker', this.broker);
```

Any module or user code can retrieve providers:

```typescript
const broker = app.getProvider<IServiceBroker>('broker');
```

### Pending Queue Mechanism

When `registerProvider('broker', ...)` is called, `MeshApp` flushes two queues:

1. **`pendingMiddleware`** — Middleware registered via `app.use(fn)` before the broker existed.
2. **`pendingModules`** — Service modules registered via `app.registerModule(mod)` before the broker existed.

This means module registration order is flexible. You can call `app.registerModule(new SandboxService())` before `app.use(new BrokerModule())`, and it will work correctly.

### Typed RPC Interface

`MeshApp` exposes a fully type-safe `call` method that delegates to the broker:

```typescript
const result = await app.call('sandbox.create', {
    name: 'my-sandbox',
    image: 'node:18',
    gitUrl: 'https://github.com/example/repo.git',
    status: 'active'
}, { timeout: 60000 });
```

The generic constraint `K extends keyof IServiceToolRegistry` is populated at compile time by the code generator, giving you autocomplete and type checking on every tool name, parameter shape, and return type.

---

## Boot Sequence

[BootOrchestrator.ts](file:///home/ubuntu/code/mesh/src/core/BootOrchestrator.ts) manages a strict three-phase startup and a reverse-order teardown.

### Phase 1: `onInit` — Initialization

Each module's `onInit(app)` is called in registration order. This is where modules:
- Receive the logger reference
- Receive the broker reference (if available yet)
- Create their internal state
- Register themselves as DI providers

The orchestrator proactively checks for the broker provider after each module's `onInit`, so that if `BrokerModule.onInit` registers the broker, subsequent modules in the same phase will receive it.

### Phase 2: `onStart` — Activation

Each module's `onStart(app)` is called in registration order. This is where:
- `RegistryModule` starts its pruning timer (every 5s) and metrics timer (every 10s)
- `NetworkModule` starts the WebSocket server, connects to bootstrap peers, and begins gossip
- `DatabaseModule` connects to MongoDB and installs the CRUD middleware onto the broker
- `BrokerModule` calls `onStart` on every registered service module

### Phase 3: `onReady` — Final State

Called after all modules have started. Currently used for post-start hooks.

### Teardown

On `app.stop()`, modules are stopped in **reverse registration order**. This ensures the broker drains before the network closes, and the network closes before the registry stops pruning.

### Circular Dependency Detection

Before any boot phase runs, the orchestrator performs a DFS cycle check on module `dependencies` arrays. If a cycle is found, it throws a `MeshError` with code `CIRCULAR_DEPENDENCY` and a trace showing the cycle path.

---

## Module Registration Order

The canonical registration order matters because modules depend on providers from earlier modules:

```typescript
app.use(new RegistryModule());      // 1. Registry (no deps)
app.use(new NetworkModule({...}));   // 2. Network (needs 'registry')
app.use(new DatabaseModule({...})); // 3. Database (no deps, but installs middleware on broker)
app.use(new BrokerModule());        // 4. Broker (needs 'registry' and 'network')
```

`NetworkModule.onInit` will throw if `registry` is not yet registered. `BrokerModule.onInit` links to both `registry` and `network` if available.

---

## Service Modules

[ServiceModule.ts](file:///home/ubuntu/code/mesh/src/core/ServiceModule.ts) is the abstract base class for all domain services. A service declares:

1. **A `domain` name** — a unique namespace string (e.g. `'sandbox'`, `'agent'`, `'infer'`)
2. **Tool mounts** — via `this.mountTool(contract, handler)`
3. **CRUD mounts** — via `this.mountCrud(crudContracts)` (handlers are intercepted by `DatabaseMiddleware`)
4. **Time Series mounts** — via `this.mountTimeSeries(tsContracts)`
5. **CRUD hooks** — via `this.mountCrudHook(domain, action, { before, after })`
6. **Event handlers** — via `this.mountEventHandler('event.name', handler)`

### Example

```typescript
export class SandboxService extends ServiceModule {
    public readonly domain = 'sandbox';

    constructor() {
        super();
        this.mountCrud(sandboxCrud);
        this.mountTool(setActiveContract, this.handleSetActive.bind(this));
        this.mountTool(fsReadContract, this.handleFsRead.bind(this));
        this.mountEventHandler('data.created', (payload, ctx) => {
            if (payload.domain === 'sandbox') {
                // post-creation provisioning
            }
        });
    }

    private async handleSetActive(params: { id: string }, ctx: IServiceContext) {
        // implementation
    }
}
```

### CRUD Hook Lifecycle

When a CRUD tool (e.g. `sandbox.create`) is invoked:

1. `DatabaseMiddleware` intercepts the call (it checks `MeshToolSchemaRegistry` for `isCrud: true`)
2. It calls `module.beforeCrud(domain, action, params, ctx)` — you can transform input here
3. It executes the database operation via `DomainRepository`
4. It calls `module.afterCrud(domain, action, result, ctx)` — you can transform output here
5. It emits a `data.created` / `data.updated` / `data.deleted` event automatically

---

## Error Handling

[MeshError.ts](file:///home/ubuntu/code/mesh/src/core/MeshError.ts) provides structured errors with `message`, `code`, `status`, and optional `data`. The broker preserves error stack traces across network boundaries by appending a `--- Remote Boundary ---` marker, so you can trace the call across nodes.

```

// FILE: CLI_REFERENCE.md
```md
# CLI Reference

## Overview

Mesh provides a powerful, dynamically-generated Command Line Interface. Instead of hardcoding CLI commands for every tool, the Mesh CLI reads your strictly-typed `ToolContract` definitions and auto-generates Commander.js subcommands with full argument parsing, validation, and help text.

The CLI is invoked via `npx mesh` or `mesh`.

---

## Global Options

The root CLI program accepts options that apply to all subcommands:

| Option | Shorthand | Description | Default |
|---|---|---|---|
| `--node-id <id>` | `-i` | Explicit node identifier | `cli-<random>` |
| `--bootstrap <urls>` | `-b` | Comma-separated list of bootstrap WebSocket URLs | `ws://127.0.0.1:5005` |
| `--port <number>` | `-p` | Port for the WebSocket server | `0` (random) |

*Note on Port*: If you specify `--port 0` (or omit it and run a tool command), the CLI will pick a random ephemeral port to avoid conflicts. If you run `mesh start --port 5005`, it will bind to exactly `5005`.

---

## Built-in Commands

### `mesh start`

Starts a long-running Mesh node.

```bash
npx mesh start --port 5005 --bootstrap ws://127.0.0.1:5005 --services src/
```

**Options**:
- `--services <paths...>` or `-s`: Directories containing service modules (e.g. `src/`, `../mesh-sandbox/src`). The startup sequence recursively scans these directories for `*.service.ts` or `*.service.js` files, instantiates the default export, and registers it.
- `--log-level <level>` or `-l`: `debug`, `info`, `warn`, `error` (default: `info`)

**Multi-Service Loading**:
The `--services` flag accepts multiple paths, either comma-separated or by providing the flag multiple times.

```bash
npx mesh start -s src/ -s ../mesh-sandbox/src
```

### `mesh generate`

Scans all `*.contract.ts` files in your codebase and generates the type-safe CLI and RPC bindings.

```bash
npx mesh generate --contracts "src/**/*.contract.ts" --out "src/generated"
```

**Options**:
- `--contracts <glob>`: Glob pattern to find contract files.
- `--out <dir>`: Output directory for generated files.

**Output Artifacts**:
1. `api.ts`: Augments `IServiceToolRegistry` for type-safe `broker.call()`.
2. `events.ts`: Augments `EventRegistry` for type-safe `broker.on()`.
3. `cli/ToolCommands.ts`: Auto-generated Commander.js subcommands.

---

## Auto-Generated Tool Commands

Every tool defined via `defineContract` (or `defineCrud`) becomes a CLI command. The CLI structure maps directly to the `domain.action` format.

**Format**:
```bash
npx mesh <domain> <action> [options]
```

### Argument Parsing

The CLI generator maps Zod schema fields to Commander options:
- `z.string()` → `--name <string>`
- `z.number()` → `--age <number>`
- `z.boolean()` → `--active` (flag)
- `z.array(z.string())` → `--tags <string...>`

### Dot-Notation for Nested Objects

If a contract has a nested `z.object()` or a `z.record()`, the CLI supports dot-notation to populate those fields without needing to write JSON strings:

```bash
npx mesh email find_one --query.status pending --query.domain example.com
```

This is intercepted by `preprocessArgs` in `src/cli/index.ts` and rewritten to:

```bash
npx mesh email find_one --query '{"status":"pending","domain":"example.com"}'
```

### Example: CRUD Commands

If you define a sandbox CRUD using `defineCrud('sandbox', SandboxSchema)`, you get:

```bash
# Create
npx mesh sandbox create --name "My Sandbox" --image "node:18"

# Get by ID
npx mesh sandbox get --id 64a...

# Find (Search)
npx mesh sandbox find --limit 10 --sort -createdAt --query.status active

# Delete
npx mesh sandbox delete --id 64a...
```

### Output Formatting

When a tool completes, the CLI prints the result. By default, it prints raw JSON. However, if the `ToolContract` provides a custom `print(output)` function, the CLI will use it.

```typescript
export const helloContract = defineContract({
    // ...
    outputSchema: z.object({ message: z.string() }),
    print: (out) => `\n🎉 ${out.message}\n`
});
```

```bash
$ npx mesh demo hello --name World

🎉 Hello World
```

---

## Under the Hood: Tool Execution

When you run a generated tool command (e.g., `npx mesh sandbox get --id 123`):

1. **Boot**: The CLI instantiates a temporary `MeshApp` and loads the Registry, Network, and Broker modules.
2. **Network**: It connects to the cluster using the `--bootstrap` URL.
3. **Discovery**: It calls `registry.waitForTool('sandbox.get', 5000)` to wait until it discovers a peer offering the requested tool.
4. **RPC**: It executes `broker.call('sandbox.get', { id: '123' })`.
5. **Print**: It passes the result to the contract's `print` function.
6. **Teardown**: It stops the `MeshApp` and exits.

Because of this architecture, the CLI node acts as a temporary peer in the network. It does not need a local database connection — it discovers the active backend service and routes the RPC request over WebSockets.

```

// FILE: DATABASE_INTEGRATION.md
```md
# Database Integration

## Overview

The database layer provides automatic MongoDB persistence for any CRUD contract. When a service calls `this.mountCrud(myCrud)`, the framework handles all database operations transparently — the service developer never writes MongoDB queries directly.

The system has three components:

| Component | File | Role |
|---|---|---|
| `Database` | [Database.ts](file:///home/ubuntu/code/mesh/src/db/Database.ts) | MongoDB connection manager, collection accessor |
| `DomainRepository` | [DomainRepository.ts](file:///home/ubuntu/code/mesh/src/db/DomainRepository.ts) | Typed CRUD operations against a single collection |
| `TimeSeriesRepository` | [TimeSeriesRepository.ts](file:///home/ubuntu/code/mesh/src/db/TimeSeriesRepository.ts) | Specialized repository for MongoDB Time Series collections |
| `DatabaseMiddleware` | [DatabaseMiddleware.ts](file:///home/ubuntu/code/mesh/src/db/DatabaseMiddleware.ts) | Broker middleware that intercepts CRUD/TS tools and routes to repositories |

---

## Database Connection

`Database` wraps the MongoDB native driver. It reads the connection URI from `MONGODB_URI` environment variable (or accepts it as a constructor argument) and connects using `MongoClient.connect()`.

```typescript
const db = new Database(logger, 'mongodb+srv://...', 'my-app');
await db.connect();
```

The database name is extracted from the URI path, or falls back to the second constructor argument, or defaults to `'mesh'`.

`db.repo(schema, domain)` creates or retrieves a `DomainRepository` for a given domain name. The collection name equals the domain name.

---

## DomainRepository

`DomainRepository<T>` is a strictly-typed gateway to a MongoDB collection. Every method validates input and output through Zod schemas — there is zero use of `any`.

### ID Mapping

MongoDB uses `_id: ObjectId` internally, but the application layer uses `id: string`. The repository handles this translation transparently:

- **Inbound** (`mapQuery`): Converts `{ id: '...' }` filters to `{ _id: new ObjectId('...') }`. Also handles MongoDB operators like `$in`, `$nin`, `$eq`, `$ne` on ID fields, and recursively maps `$or` / `$and` arrays.
- **Outbound** (`mapOutbound`): Strips `_id`, adds `id: _id.toString()`, and validates the result through the Zod schema.

### Operations

#### `find(options)`

```typescript
const items = await repo.find({
    query: { status: 'active' },
    limit: 10,
    offset: 20,
    sort: '-createdAt',       // Descending by createdAt
    fields: ['name', 'status'],
    search: 'test',
    searchFields: ['name']
});
```

Supports `offset` (skip), `limit`, and flexible sort parsing:
- String: `'-createdAt'` → `{ createdAt: -1 }`
- Array: `['name', '-createdAt']` → `{ name: 1, createdAt: -1 }`
- Object: `{ createdAt: -1 }` → passed directly

#### `findOne(query, options)`

Same as `find` but returns a single document or `undefined`. Supports `sort` and `offset`.

#### `get(id)`

Direct lookup by string ID. Returns `undefined` if the ID is not a valid ObjectId or doesn't exist.

#### `create(data)`

1. Generates a new `ObjectId` (or uses the provided `id` if it's a valid ObjectId string)
2. Sets `createdAt` and `updatedAt` to `new Date()`
3. Validates the complete document through the Zod schema
4. Inserts into MongoDB
5. Returns the validated document with `id` as a string

#### `update(id, data)`

Uses `$set` with `findOneAndUpdate` and `returnDocument: 'after'`. Always sets `updatedAt` to the current time. Returns the updated document.

#### `replace(id, data)`

Uses `findOneAndReplace`. Preserves the original `createdAt` and sets a new `updatedAt`. Returns the replaced document.

#### `delete(id)`

Calls `deleteOne`. Returns `true` if a document was deleted.

#### `count(query)`

Returns the number of documents matching the query.

#### `resolve(params)`

Batch-resolves one or more IDs:
- If given a single string ID: returns one document (throws if not found)
- If given an array of IDs: returns an array of documents via `$in` query

#### `list(options)` (Paginated)

Returns a `ListResult<T>` with: `rows`, `total`, `page`, `pageSize`, `totalPages`. Uses page-based pagination (1-indexed).

---

## DatabaseMiddleware

[DatabaseMiddleware.ts](file:///home/ubuntu/code/mesh/src/db/DatabaseMiddleware.ts) is installed as **local middleware** on the broker during `DatabaseModule.onStart()`:
`db.repo(schema, domain)` creates or retrieves a `DomainRepository` for a given domain name. The collection name equals the domain name.

`db.tsRepo(schema, domain)` creates or retrieves a `TimeSeriesRepository`. It automatically ensures the collection is created with MongoDB's `timeseries` metadata (using `timestamp` as the time field and `tags` as the meta field).

---

## DomainRepository
...
---

## TimeSeriesRepository

`TimeSeriesRepository<T>` is a specialized repository for time-indexed data. It leverages MongoDB's native Time Series collections for optimized storage and querying.

### Operations

- `insert(points)`: Batch inserts multiple data points. Automatically sets `timestamp` if missing.
- `query(params)`: Retrieves points within a time range (`from`, `to`) and/or matching specific `tags`.
- `latest(tags)`: Returns the single most recent data point for the given tags.
- `aggregate(params)`: Performs time-bucketed aggregation (e.g., `'1m'`, `'1h'`) using `$dateTrunc` and various accumulation functions (`min`, `max`, `avg`, `sum`, `count`).

---

## DatabaseMiddleware
...
1. Check `MeshToolSchemaRegistry` for `isCrud: true` or `isTimeSeries: true` on the tool
2. If not intercepted, call `next()` immediately
3. For CRUD:
    - Look up the domain's Zod output schema
    - Get a `DomainRepository`
    - Execute the database operation
4. For Time Series:
    - Get a `TimeSeriesRepository`
    - Execute `insert`, `query`, `aggregate`, or `latest`
5. Auto-emit lifecycle events for CRUD mutations
6. Return the result

### Action Routing (CRUD)
...
| `delete` | `repo.delete(id)` | `data.deleted` |
| `resolve` | `repo.resolve(params)` | None |

### Action Routing (Time Series)

| Action | Repository Operation |
|---|---|
| `insert` | `repo.insert(points)` |
| `query` | `repo.query(params)` |
| `aggregate` | `repo.aggregate(params)` |
| `latest` | `repo.latest(tags)` |

### ServiceContext Bridge
...
The middleware constructs a `serviceCtx` object for CRUD hooks that provides fully typed `call` and `emit` methods, preventing hook implementations from needing to cast or use `any`:

```typescript
const serviceCtx = {
    broker,
    correlationId: ctx.correlationID,
    nodeID: broker.nodeID,
    call: <K extends keyof IServiceToolRegistry>(a: K, p: ...) => broker.call(a, p),
    emit: <K extends keyof EventRegistry>(e: K, p: ...) => broker.emit(e, p),
    logger: broker.logger
};
```

---

## DatabaseModule

[DatabaseModule.ts](file:///home/ubuntu/code/mesh/src/modules/DatabaseModule.ts) manages the database lifecycle:

| Phase | Action |
|---|---|
| `onInit` | Creates the `Database` instance, registers it as the `database` provider |
| `onStart` | Connects to MongoDB, installs `DatabaseMiddleware` on the broker |
| `onStop` | Disconnects from MongoDB |

### Configuration

```typescript
app.use(new DatabaseModule({
    uri: 'mongodb+srv://user:pass@cluster.mongodb.net/mydb',
    dbName: 'override-name'  // Optional, extracted from URI if omitted
}));
```

If no `uri` is provided, it falls back to `process.env.MONGODB_URI`.

```

// FILE: MODULES_AND_EXTENSIONS.md
```md
# Modules & Extensions

## The Module System

Mesh uses a module-based plugin architecture. Every system capability — registry, networking, database, broker — is a module that conforms to the `IMeshModule` interface and plugs into `MeshApp` via `app.use()`.

---

## IMeshModule Interface

[IMeshModule.ts](file:///home/ubuntu/code/mesh/src/interfaces/IMeshModule.ts)

```typescript
interface IMeshModule {
    readonly name: string;
    logger?: ILogger;
    serviceBroker?: IServiceBroker;
    dependencies?: string[];

    onInit?(app: IMeshApp): Promise<void> | void;
    onStart?(app: IMeshApp): Promise<void> | void;
    onStop?(app: IMeshApp): Promise<void> | void;
    onReady?(app: IMeshApp): Promise<void> | void;
}
```

| Hook | When Called | Use Case |
|---|---|---|
| `onInit` | Boot Phase 1 | Create internal state, register DI providers. `app.registerProvider(key, instance)` |
| `onStart` | Boot Phase 2 | Connect to external services, start listeners, install middleware |
| `onStop` | Teardown (reverse order) | Disconnect, drain queues, clean up resources |
| `onReady` | Boot Phase 3 | Post-start hooks (all modules are running) |

The `dependencies` array enables the `BootOrchestrator` to detect circular dependencies before any hooks run.

---

## Built-in Modules

### RegistryModule

[RegistryModule.ts](file:///home/ubuntu/code/mesh/src/modules/RegistryModule.ts)

Creates and manages the service `Registry`. Must be registered first since `NetworkModule` depends on it.

**`onInit`**: Creates a `Registry` instance with the app's `nodeID` and registers it as the `registry` provider.

**`onStart`**: Starts the registry's pruning timer (5s) and metrics timer (10s).

**`onStop`**: Clears both timers.

**Options**:
```typescript
app.use(new RegistryModule({
    preferLocal: true,    // Default. Always route to local tools first.
    dhtEnabled: false,    // Enable Kademlia DHT for large clusters.
    ttl: 30000,           // Node heartbeat TTL in ms.
}));
```

---

### NetworkModule

[NetworkModule.ts](file:///home/ubuntu/code/mesh/src/modules/NetworkModule.ts)

Creates and manages the `MeshNetwork`, which owns the full P2P networking stack (transport, dispatcher, controller, orchestrator).

**`onInit`**: Retrieves the `registry` provider. Creates a `MeshNetwork` with the configured port, transports, and bootstrap nodes. Registers as the `network` provider.

**`onStart`**: Starts the WebSocket server (if running on Node.js with a port), connects transports, starts the `MeshOrchestrator` (gossip + presence broadcasting).

**`onStop`**: Stops the orchestrator, disconnects transports, shuts down the server.

**Options**:
```typescript
const serializer = new JSONSerializer();
const wsTransport = new WSTransport(serializer, port);

app.use(new NetworkModule({
    port: 5005,
    namespace: 'production',
    bootstrapNodes: ['ws://192.168.1.10:5005'],
    transports: [wsTransport],
}));
```

**Dependency**: Requires `registry` to be registered first. Throws on `onInit` if missing.

---

### BrokerModule

[BrokerModule.ts](file:///home/ubuntu/code/mesh/src/modules/BrokerModule.ts)

Creates and manages the `ServiceBroker`.

**`onInit`**: Creates a `ServiceBroker` with the app's `nodeID` and logger. Links the broker to the `registry` and `network` providers if they exist. Registers as the `broker` provider — this triggers `MeshApp` to flush pending middleware and pending service modules.

**`onStart`**: Calls `broker.start()`, which sets `isStarted = true`, calls `onStart` on all plugins, and calls `onStart` on all registered service modules.

**`onStop`**: Calls `broker.stop()`, which clears pending requests and stops all service modules and plugins.

---

### DatabaseModule

[DatabaseModule.ts](file:///home/ubuntu/code/mesh/src/modules/DatabaseModule.ts)

Creates the MongoDB connection and installs the CRUD/TS interception middleware.

**`onInit`**: Creates a `Database` instance and registers it as the `database` provider.

**`onStart`**: Connects to MongoDB. If the broker is available, creates a `DatabaseMiddleware` and installs it as **local middleware** on the broker via `broker.useLocal()`. This means the CRUD and Time Series interception only applies to tools executed on the local node (remote RPC calls are forwarded as-is).

**`onStop`**: Disconnects from MongoDB.

**Options**:
```typescript
app.use(new DatabaseModule({
    uri: process.env.MONGODB_URI,
    dbName: 'mesh-agents'
}));
```

---

## Writing a Custom Module

Any class implementing `IMeshModule` can be plugged in:

```typescript
import type { IMeshModule, IMeshApp, ILogger } from 'mesh';

export class MetricsModule implements IMeshModule {
    public readonly name = 'metrics';
    public logger?: ILogger;
    public dependencies = ['broker']; // Will fail on circular dep check

    onInit(app: IMeshApp): void {
        this.logger = app.logger;
        // Register any providers
        app.registerProvider('metrics', this);
    }

    async onStart(app: IMeshApp): Promise<void> {
        const broker = app.getProvider<IServiceBroker>('broker');
        // Install a global middleware that records timing
        broker.use(async (ctx, next) => {
            const start = Date.now();
            try {
                return await next();
            } finally {
                const duration = Date.now() - start;
                this.logger?.info(`[Metrics] ${ctx.toolName} took ${duration}ms`);
            }
        });
    }

    async onStop(): Promise<void> {
        // Cleanup
    }
}
```

Usage:
```typescript
app.use(new RegistryModule());
app.use(new NetworkModule({ ... }));
app.use(new BrokerModule());
app.use(new MetricsModule()); // Custom module, after broker
```

---

## Module vs Service Module

These are different concepts:

| | `IMeshModule` | `ServiceModule` |
|---|---|---|
| Purpose | System infrastructure plugin | Domain service with business logic |
| Registration | `app.use(new MyModule())` | `app.registerModule(new MyService())` |
| Lifecycle | Managed by `BootOrchestrator` | Managed by `ServiceBroker` |
| Hooks | `onInit`, `onStart`, `onStop`, `onReady` | `onInit(broker)`, `onStart(broker)`, `onStop(broker)` |
| Provides | DI providers, middleware | Tools, CRUD, Time Series, events |
| Examples | RegistryModule, NetworkModule | SandboxService, InferService |

`ServiceModule` instances are registered **through** the broker (either directly or via pending queue), and the broker calls their lifecycle hooks. `IMeshModule` instances are managed directly by the `BootOrchestrator`.

```

// FILE: P2P_NETWORKING_AND_DISCOVERY.md
```md
# P2P Networking & Discovery

## Network Stack Overview

The networking layer is composed of five cooperating classes:

| Class | File | Responsibility |
|---|---|---|
| `MeshNetwork` | [MeshNetwork.ts](file:///home/ubuntu/code/mesh/src/core/MeshNetwork.ts) | Top-level network facade: packet send/receive, interceptors, deduplication |
| `TransportManager` | [TransportManager.ts](file:///home/ubuntu/code/mesh/src/core/TransportManager.ts) | Manages multiple transport backends (currently WebSocket) |
| `NetworkDispatcher` | [NetworkDispatcher.ts](file:///home/ubuntu/code/mesh/src/core/NetworkDispatcher.ts) | Routes incoming packets to registered topic handlers |
| `NetworkController` | [NetworkController.ts](file:///home/ubuntu/code/mesh/src/core/NetworkController.ts) | Handles system-level packets (`$node.ping`, `$node.pex`, `$node.presence`, etc.) |
| `MeshOrchestrator` | [MeshOrchestrator.ts](file:///home/ubuntu/code/mesh/src/core/MeshOrchestrator.ts) | Gossip protocol, presence broadcasting, peer exchange (PEX), bootstrap |

---

## Packet Format

Every message on the wire is a `MeshPacket`:

```typescript
interface MeshPacket<T = unknown> {
    id: string;                     // Unique packet ID
    topic: string;                  // Routing key (tool name or system topic)
    data: T;                        // Payload
    error?: { message, code?, data? }; // Error payload (for RESPONSE_ERROR)
    type: 'EVENT' | 'REQUEST' | 'RESPONSE' | 'RESPONSE_ERROR';
    senderNodeID: string;           // Originating node
    targetNodeID?: string;          // Specific destination (undefined = broadcast)
    namespace: string;              // Namespace isolation
    timestamp: number;              // Unix ms
    version: number;                // Protocol version
    priority: number;               // 1 = normal, 2 = protocol (raft/kademlia)
    meta: {
        ttl?: number;               // Hop limit
        path?: string[];            // Nodes this packet has traversed
        correlationID?: string;     // For request/response pairing
        timeout?: number;           // RPC timeout hint
        traceId?: string;           // Distributed tracing
        spanId?: string;
        parentId?: string;
    }
}
```

---

## Packet Processing Pipeline

When a packet arrives from a transport:

### 1. Loopback Suppression

Packets from `this.nodeID` are silently dropped. The `ServiceBroker` already handles local delivery directly — network packets from self are duplicates caused by broadcast.

### 2. Namespace Isolation

If the packet's `namespace` differs from the local node's namespace, it is dropped. This allows multiple logical networks to share the same physical transport.

### 3. Deduplication

Non-response packets are checked against a `seenPackets` map (keyed by `packet.id`). If already seen within the TTL window (10 seconds), the packet is dropped. Response packets skip deduplication because request and response share the same correlation ID.

### 4. Heartbeat Refresh

Every accepted packet refreshes the sender's heartbeat in the `Registry`, preventing the sender from being pruned as stale.

### 5. Interceptor Chain

Inbound interceptors (e.g. circuit breakers) process the packet in reverse registration order via `interceptor.onInbound(packet)`.

### 6. Generic Handlers

The packet is dispatched to the `ServiceBroker`'s wildcard handler (registered via `network.onMessage('*', ...)`). This is where the broker processes `REQUEST`, `RESPONSE`, `RESPONSE_ERROR`, and `EVENT` packets.

### 7. Specific Handlers

The packet is dispatched through the `NetworkDispatcher` to topic-specific handlers (registered by `NetworkController`).

---

## Outbound Packet Processing

When sending via `network.send(targetNodeID, topic, data, options)`:

1. A `MeshPacket` is constructed with the sender's node ID, namespace, version, and priority
2. Protocol topics (`raft.*`, `kademlia.*`) get elevated priority (2)
3. Each outbound interceptor's `onOutbound(packet)` is called in registration order
4. If any interceptor rewrites the topic to `__circuit_open`, the send throws immediately (circuit breaker)
5. The packet is handed to `TransportManager.send(nodeID, packet)`

Broadcasting (`targetNodeID = '*'`) uses `network.publish()` instead, which broadcasts to all connected peers.

---

## MeshOrchestrator — Gossip & Discovery

[MeshOrchestrator.ts](file:///home/ubuntu/code/mesh/src/core/MeshOrchestrator.ts) is the gossip protocol engine. It manages three periodic processes:

### Bootstrap

On startup, if `bootstrapNodes` are configured, the orchestrator iterates each URL and calls `node.connectToPeer(tempId, url)`. The transport establishes a WebSocket connection and the handshake resolves the actual node ID.

### Presence Broadcasting (every 15s)

The orchestrator publishes the local node's full `NodeInfo` (including all registered services, tools, and health metrics) to all peers via `$node.presence`. When a **new** node receives a presence packet from an unknown peer, it immediately sends its own presence back — this ensures bidirectional discovery.

Presence is also re-broadcast immediately whenever the local registry emits `local:changed` (e.g. when a new service module is registered).

### Gossip / Peer Exchange (every 10s)

The orchestrator selects a random available peer and publishes `$node.pex` with a random subset (up to 50) of known nodes. This propagates cluster knowledge even when nodes can't directly reach each other.

### Peer Connect / Disconnect

When the transport layer detects a new connection:
- `handlePeerConnect(nodeID)` sends both a targeted presence broadcast and a full PEX dump to the new peer

When a disconnect is detected:
- `handlePeerDisconnect(nodeID)` immediately removes the node from the registry

---

## NetworkController — System Packet Handlers

[NetworkController.ts](file:///home/ubuntu/code/mesh/src/core/NetworkController.ts) registers handlers for all system-level topics:

| Topic | Purpose |
|---|---|
| `$node.ping` | Refresh sender's heartbeat, reply with `$node.pong` |
| `$node.pong` | Refresh sender's heartbeat |
| `$node.pex` | Forward to `MeshOrchestrator.handlePEX()` to merge peer lists |
| `$node.presence` | Forward to `MeshOrchestrator.handlePresence()` to register/update the node |
| `$node.announce` | Legacy node announcement (registers basic node info) |
| `$rpc.request` | Debug logging for direct RPC |
| `$rpc.response` | Placeholder (responses are handled by correlation in broker) |

---

## Registry — Service Catalog

[Registry.ts](file:///home/ubuntu/code/mesh/src/core/Registry.ts) maintains the global view of all known nodes and their capabilities.

### Node Registration

Every node is stored as a `RegistryNodeInfo`:

```typescript
{
    nodeID: string,
    type: 'node',
    namespace: string,
    addresses: string[],         // WebSocket URLs
    services: ServiceInfo[],     // Each has a name and tools map
    available: boolean,
    timestamp: number,           // Last heartbeat
    nodeSeq: number,             // Monotonic version counter
    healthScore: number,         // 0.0 (overloaded) to 1.0 (ideal)
    cpu: number,                 // CPU usage percentage
    hostname: string,
    pid: number,
    trustLevel: 'internal' | 'public',
    capabilities: { transports, features },
    metadata: Record<string, unknown>,
}
```

**Sequence-based conflict resolution**: When a node registration arrives, if the existing `nodeSeq` is higher than the incoming one, the update is silently rejected. If equal, only the timestamp is refreshed. This prevents stale gossip from overwriting newer data.

### Tool Endpoint Resolution

`registry.selectNode(toolName)` finds the best node to handle a tool call:

1. Iterate all available nodes and their services
2. For each service, check if its `tools` map contains the requested tool name
3. Tool lookup supports both full keys (`sandbox.create`) and short keys (`create` within the `sandbox` service)
4. If `preferLocal` is true (default), the local node is always returned if it has the tool
5. Otherwise, pass all candidates through the `RoundRobinBalancer` to select a peer

### Stale Node Pruning (every 5s)

- Nodes with `timestamp` older than `ttl` (default 30s) are marked `available = false`
- Nodes older than `2 × ttl` (60s) are fully removed from the registry and DHT

### Local Metrics Update (every 10s)

The registry periodically updates the local node's CPU and memory metrics using `os.cpus()` and `process.memoryUsage()`. The `healthScore` is computed as:

```
healthScore = max(0, 1.0 - (cpu / 100) - (activeRequests / 50))
```

This feeds into load-aware routing decisions.

### Wait Helpers

The registry provides async wait methods for service discovery:

```typescript
await registry.waitForService('sandbox', 15000);
await registry.waitForTool('sandbox.create', 5000);
await registry.waitForNodes(3, 15000);
```

These subscribe to the `changed` event and resolve when the condition is met, or reject on timeout.

---

## Kademlia DHT

[KademliaRoutingTable.ts](file:///home/ubuntu/code/mesh/src/core/KademliaRoutingTable.ts) implements XOR-distance based node organization with 256 k-buckets (k=20 per bucket).

### Node ID Hashing

Node IDs are converted to 256-bit BigInt values by hex-encoding the string characters and padding to 64 hex digits.

### Bucket Assignment

XOR distance between the local node and a peer determines which bucket the peer belongs to. The bucket index is `floor(log2(distance))`.

### Node Lookup

`findClosestNodes(targetID, count)` scans outward from the target's bucket, collecting nodes sorted by ascending XOR distance.

### Tool Lookup

`findNodesForTool(toolName, count)` scans all buckets linearly for nodes whose services include the requested tool.

The DHT is optional — enable it via `new RegistryModule({ dhtEnabled: true })`. When disabled, the `Registry` uses flat iteration over all nodes (which is perfectly efficient for clusters under ~100 nodes).

---

## Load Balancing

[RoundRobinBalancer.ts](file:///home/ubuntu/code/mesh/src/balancers/RoundRobinBalancer.ts) extends `BaseBalancer` and cycles through candidate nodes in order. The balancer is used by `Registry.getNextToolEndpoint()` when multiple nodes offer the same tool.

Custom balancers can be installed via `registry.setBalancer(new MyBalancer())`.

```

// FILE: SERVICE_BROKER_AND_CONTRACTS.md
```md
# Service Broker & Contracts

## The Broker

[ServiceBroker.ts](file:///home/ubuntu/code/mesh/src/core/ServiceBroker.ts) is the central RPC and event dispatch engine. Every `broker.call()` and `broker.emit()` flows through it. It determines whether a tool is local (invoke in-process) or remote (serialize and send over the network), manages middleware pipelines, handles timeouts, and correlates request/response pairs for network RPC.

### Internal State

| Field | Type | Purpose |
|---|---|---|
| `localTools` | `Map<string, LocalTool>` | Handlers for tools registered by local service modules |
| `modules` | `IServiceModule[]` | All registered service modules |
| `globalMiddleware` | `IMiddleware[]` | Middleware applied to ALL calls (local and remote) |
| `localMiddleware` | `IMiddleware[]` | Middleware applied only to LOCAL calls (e.g. `DatabaseMiddleware`) |
| `pendingRequests` | `Map<string, {resolve, reject, timeout}>` | Correlation map for in-flight remote RPC calls |
| `plugins` | `IBrokerPlugin[]` | Lifecycle plugins |
| `localEvents` | `EventEmitter` | Local event bus for `broker.on()` / `broker.emit()` |

### Call Resolution Path

When you call `broker.call('sandbox.create', params)`:

1. **Input validation** — The broker looks up the tool's Zod `inputSchema` from `MeshToolSchemaRegistry` and calls `.parse(params)`. Invalid input throws immediately.

2. **Target resolution** — If no `options.nodeID` is specified and the tool is not in `localTools`, the broker asks the `Registry.selectNode(toolName)` to find a remote peer. The registry uses `RoundRobinBalancer` with `preferLocal: true` (local tools are always preferred).

3. **Context creation** — A full `IContext` is built with: unique `id`, `correlationID` (inherited from parent context or generated), `traceId`/`spanId`/`parentId` for distributed tracing, `toolName`, `params`, `meta` (includes timeout), and `targetNodeID`.

4. **Timeout race** — The broker creates a `Promise.race` between the actual handler execution and a timeout promise. Default timeout is **10 seconds**. Custom timeouts are resolved from: `options.timeout` → `schema.timeout` (from `defineContract`) → 10000ms fallback.

5. **Middleware pipeline** — The call passes through `globalMiddleware`, then `localMiddleware` (for local calls only), then reaches the final handler.

6. **Local execution** — If the tool is local, the broker invokes the `LocalTool.handler`, which calls `module.execute(domain, action, params, serviceCtx)`.

7. **Remote execution** — If the tool is remote, the broker calls `executeRemote()`, which serializes the request into a `MeshPacket` with `type: 'REQUEST'`, sends it via `network.send()`, and stores the correlation entry in `pendingRequests`. When the response packet arrives (via `setupNetworkListeners`), it resolves or rejects the pending promise.

8. **Output validation** — The result is parsed against the Zod `outputSchema` before being returned to the caller.

### Middleware

Middleware follows the classic `(ctx, next) => Promise<unknown>` pattern:

```typescript
// Global middleware — runs on every call
broker.use(async (ctx, next) => {
    console.log(`Calling ${ctx.toolName}`);
    const result = await next();
    console.log(`${ctx.toolName} returned`);
    return result;
});

// Local middleware — only runs when the tool is executed locally
broker.useLocal(async (ctx, next) => {
    // DatabaseMiddleware is installed here
    return await next();
});
```

The execution chain is: `globalMiddleware[0] → globalMiddleware[1] → ... → localMiddleware[0] → ... → finalHandler`.

### Network Listeners

When `setNetwork()` is called, the broker subscribes to ALL incoming packets via `network.onMessage('*', ...)` and routes them by `packet.type`:

| Packet Type | Behavior |
|---|---|
| `RESPONSE` | Resolves the pending promise in `pendingRequests` using `correlationID` |
| `RESPONSE_ERROR` | Rejects the pending promise, reconstructing the remote error with stack trace |
| `REQUEST` | Calls `handleIncomingRPC(packet)`, executes the tool locally, sends back `RESPONSE` or `RESPONSE_ERROR` |
| `EVENT` | Triggers `_triggerLocal(topic, data, packet)` on the local event bus |

### Event System

Events are emitted both locally and over the network:

```typescript
broker.emit('sandbox.created', { id: '...', name: '...' });
```

This:
1. Creates an `EVENT` packet
2. Calls `_triggerLocal()` which fires the event on the local `EventEmitter` (for `broker.on()` subscribers)
3. Also fires `__pattern_event` for wildcard (`*`) pattern subscribers
4. If `skipNetwork` is not set, publishes via `network.publish()` to all peers

**Pattern subscriptions** use regex matching:

```typescript
broker.on('sandbox.*', (data, packet) => {
    // Fires for sandbox.created, sandbox.deleted, etc.
});
```

---

## Tool Contracts

[IToolContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/IToolContract.ts) defines the `ToolContract` interface and the `defineContract()` factory.

### ToolContract Interface

Every tool contract has these fields:

| Field | Type | Required | Description |
|---|---|---|---|
| `domain` | `string` | Yes | Namespace. Must NOT contain underscores. |
| `action` | `string` | Yes | Action name within the domain. |
| `description` | `string` | Yes | Human-readable description (used in CLI and AI agent tools). |
| `inputSchema` | `z.ZodTypeAny` | Yes | Zod schema for input validation. |
| `outputSchema` | `z.ZodTypeAny` | Yes | Zod schema for output validation. |
| `rest` | `RestMeta` | Yes | HTTP method, path pattern, and stream flag. |
| `destructive` | `boolean` | No | If `true`, marks as a state-modifying tool (used by AI agents for approval flows). |
| `isCrud` | `boolean` | No | If `true`, the `DatabaseMiddleware` intercepts this tool. |
| `isTimeSeries` | `boolean` | No | If `true`, the `DatabaseMiddleware` intercepts this as a time-series tool. |
| `event` | `boolean \| string` | No | Auto-emit an event after execution. |
| `timeout` | `number` | No | Custom RPC timeout in milliseconds. |
| `print` | `(output) => string` | Yes | Formats output for CLI display and AI agent consumption. |

### defineContract()

```typescript
export const setActiveContract = defineContract({
    domain: 'sandbox',
    action: 'set_active',
    description: 'Set the active sandbox for subsequent operations.',
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ success: z.boolean() }),
    rest: { method: 'POST', path: '/sandbox/set_active' },
    timeout: 5000,
    print: (out) => out.success ? 'Sandbox activated.' : 'Failed.',
});
```

`defineContract()` validates that the `domain` does not contain underscores (action names like `set_active` are allowed), then registers the contract in the `globalContractRegistry` singleton.

### Tool Key Convention

Tool keys are always `domain.action` with dot notation: `sandbox.create`, `agent.run`, `infer.chat`. The `toolKey()` function generates this, and `parseToolKey()` splits it back.

---

## CRUD Contracts

[ICrudContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/ICrudContract.ts) provides `defineCrud()`, which generates **10 standard CRUD tools** from a single Zod schema:

| Action | Tool Key | Input | Output |
|---|---|---|---|
| `create` | `domain.create` | Schema minus `id`/`createdAt`/`updatedAt` | Full output schema |
| `find` | `domain.find` | `CrudParamsSchema` (limit, offset, sort, query, etc.) | Array of output schema |
| `find_one` | `domain.find_one` | `CrudParamsSchema` | Optional output schema |
| `get` | `domain.get` | `{ id: string }` | Full output schema |
| `count` | `domain.count` | `{ query?, search?, searchFields? }` | `number` |
| `update` | `domain.update` | Partial schema + `{ id: string }` | Full output schema |
| `delete` | `domain.delete` | `{ id: string }` | `{ success: boolean }` |
| `replace` | `domain.replace` | Full schema + `{ id: string }` | Full output schema |
| `resolve` | `domain.resolve` | `{ id: string \| string[] }` | Output or array |
| `create_many` | `domain.create_many` | Array of create inputs | Array of outputs |

### Output Schema Enrichment

`defineCrud` automatically adds `id: z.string()`, `createdAt: z.date()`, and `updatedAt: z.date()` to the output schema, even if the base schema doesn't have them. This ensures consistency with MongoDB's `_id` mapping.

### Custom Timeouts Per Action

```typescript
export const sandboxCrud = defineCrud('sandbox', SandboxSchema, {
    pluralPath: 'sandboxes',
    idField: 'id',
    timeout: {
        create: 60000,  // Git clone + container creation can be slow
        find: 5000,
    }
});
```

Each key in the `timeout` dictionary maps to a CRUD action name. The timeout value is passed through to the underlying `defineContract()` call.

### CrudParamsSchema

The standard query parameters for `find` and `find_one`:

```typescript
{
    limit?: number,      // Max rows to return
    offset?: number,     // Skip N rows
    fields?: string | string[],  // Projection
    sort?: string | string[],    // '-createdAt' for descending
    search?: string,             // Full-text search
    searchFields?: string | string[],
    query?: Record<string, unknown>,  // MongoDB-style filter
    populate?: string | string[],     // Relation population
}
```

---

## Event Contracts

[IEventContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/IEventContract.ts) provides `defineEvent()` for declaring typed events.

### defineEvent()

```typescript
export const sandboxCreatedEvent = defineEvent(
    'sandbox.created',
    z.object({
        id: z.string(),
        name: z.string(),
        image: z.string(),
    })
);
```

This registers the event in the generated `EventRegistry` interface, enabling type-safe `broker.on('sandbox.created', ...)` and `broker.emit('sandbox.created', ...)`.

### Built-in Events

| Event | Schema | Emitted By |
|---|---|---|
| `mesh.started` | `{ timestamp, nodeID }` | MeshApp on start |
| `mesh.stopped` | `{ timestamp, nodeID, reason? }` | MeshApp on stop |
| `data.created` | `{ domain, id, item }` | DatabaseMiddleware after create |
| `data.updated` | `{ domain, id, patch, item }` | DatabaseMiddleware after update/replace |
| `data.deleted` | `{ domain, id }` | DatabaseMiddleware after delete |

---

## MeshToolSchemaRegistry

This is a global `Map<string, {...}>` in `ServiceBroker.ts` that stores runtime metadata for every registered tool:

```typescript
{
    params: z.ZodTypeAny,    // Input schema
    returns: z.ZodTypeAny,   // Output schema
    mutates: boolean,        // Destructive flag
    timeout: number,         // Custom timeout
    isCrud: boolean,         // CRUD interception flag
    isTimeSeries: boolean,   // TS interception flag
    domain: string           // Domain namespace
}
```

Both `ServiceBroker.call()` and `DatabaseMiddleware` consult this registry to determine validation schemas, timeouts, and whether CRUD/TS interception should apply.

---

## Time Series Contracts

[ITimeSeriesContract.ts](file:///home/ubuntu/code/mesh/src/interfaces/ITimeSeriesContract.ts) provides `defineTimeSeries()`, which generates **4 standard tools** for handling time-indexed data:

| Action | Tool Key | Purpose |
|---|---|---|
| `insert` | `domain.insert` | Batch insertion of data points |
| `query` | `domain.query` | Range-based retrieval with tag filtering |
| `aggregate` | `domain.aggregate` | Time-bucketed statistics (min, max, avg, etc.) |
| `latest` | `domain.latest` | Get the single most recent data point |

The framework automatically manages a **MongoDB Time Series collection** for these tools, handling metadata mapping and aggregation pipelines transparently.

---

## Code Generation
...
The [GenerateCommand](file:///home/ubuntu/code/mesh/src/cli/commands/GenerateCommand.ts) scans all `*.contract.ts` files and generates three artifacts under `src/generated/`:

1. **`api.ts`** — Module augmentation of `IServiceToolRegistry` with type-safe tool signatures
2. **`events.ts`** — Module augmentation of `EventRegistry` with typed event payloads
3. **`cli/ToolCommands.ts`** — Auto-generated Commander subcommands for every tool

This is what gives you compile-time autocomplete on `broker.call('sandbox.create', ...)`.

```

// FILE: TIME_SERIES_CONTRACTS.md
```md
# Time Series Contracts

## Overview

Time Series contracts in Mesh provide a first-class abstraction for handling time-indexed data. They are designed for high-throughput ingestion and efficient querying of metrics, telemetry, and event logs. 

When you define a Time Series contract, the Mesh framework automatically:
1.  Generates a set of specialized tools (`insert`, `query`, `aggregate`, `latest`).
2.  Manages an optimized **MongoDB Time Series collection** for that domain.
3.  Handles batching and time-based aggregation logic transparently.

---

## Defining a Time Series Contract

Use the `defineTimeSeries` factory to declare your data model. You only need to provide the "value" schema — the framework automatically adds `timestamp` and `tags` fields.

```typescript
import { z } from 'zod';
import { defineTimeSeries } from 'mesh';

export const telemetryContract = defineTimeSeries('telemetry', z.object({
    cpu: z.number().describe("CPU usage percentage"),
    memory: z.number().describe("Memory usage in MB"),
    load: z.number().optional()
}));
```

### Automatic Schema Enrichment

The resulting `outputSchema` for the contract will be:
- `cpu`: number
- `memory`: number
- `load`: number (optional)
- `timestamp`: Date (the primary time index)
- `tags`: Record<string, string> (metadata for filtering, e.g. `{ host: "web-01" }`)

---

## Generated Tools

A Time Series contract generates 4 standard tools for the domain:

### 1. `domain.insert`
Used for batch ingestion of data points.

- **Input**: An array of objects matching the base schema (plus optional `timestamp` and `tags`).
- **Output**: `{ count: number }`

```typescript
await broker.call('telemetry.insert', [
    { cpu: 12, memory: 512, tags: { host: 'A' } },
    { cpu: 15, memory: 540, tags: { host: 'A' } }
]);
```

### 2. `domain.query`
Retrieves raw data points within a time range.

- **Input**:
    - `from`: Start Date (optional)
    - `to`: End Date (optional)
    - `tags`: Record<string, string> filter (optional)
    - `limit`: Max points (optional)
- **Output**: Array of data points.

### 3. `domain.latest`
Retrieves the single most recent point matching the filter.

- **Input**: `{ tags?: Record<string, string> }`
- **Output**: A single data point or `undefined`.

### 4. `domain.aggregate`
Performs time-bucketed statistics.

- **Input**:
    - `from` / `to` / `tags`: Filtering criteria.
    - `interval`: Bucket size (e.g., `'1m'`, `'1h'`, `'1d'`).
    - `aggregates`: A map of field names to functions (`'min'`, `'max'`, `'avg'`, `'sum'`, `'count'`).
- **Output**: Array of buckets.

```typescript
const stats = await broker.call('telemetry.aggregate', {
    interval: '5m',
    aggregates: {
        cpu: 'avg',
        memory: 'max'
    }
});
```

---

## Implementation Details

### MongoDB Time Series Collections
On the first insertion, Mesh automatically creates a collection with the `timeseries` option enabled in MongoDB:
- `timeField`: `"timestamp"`
- `metaField`: `"tags"`
- `granularity`: `"seconds"` (default)

This ensures that MongoDB uses its specialized columnar-style storage for metrics, significantly reducing disk space and improving query performance for large datasets.

### Middleware Interception
Just like CRUD, Time Series tools are marked with `isTimeSeries: true`. The `DatabaseMiddleware` intercepts these calls and routes them to a `TimeSeriesRepository`. This repository handles the complex MongoDB aggregation pipelines required for time-bucketing (`$dateTrunc`).

---

## Best Practices

1.  **Use Tags for Cardinality**: Put stable metadata (host IDs, region, service name) in `tags`. Avoid putting highly dynamic data in tags as it can affect index performance.
2.  **Batch Your Inserts**: The `insert` tool accepts an array. For high-volume telemetry, buffer points locally and send them in batches of 50-100 to reduce network overhead.
3.  **Use Aggregate for Dashboards**: When building charts, always prefer the `aggregate` tool over `query`. It reduces the amount of data sent over the wire by summarizing points into buckets on the database server.

```

// FILE: UNIT_TESTING.md
```md
# Writing Unit Tests for Mesh Services

Testing services built on the Mesh engine requires spinning up a localized, fully wired application environment. Because Mesh relies heavily on Dependency Injection (DI), the Service Broker, and a real MongoDB persistence layer, we provide a dedicated `TestHelpers` module to make integration testing seamless and perfectly isolated.

## The Testing Philosophy

1. **Real Persistence:** We test against a real MongoDB instance rather than mocking the database. This ensures your Zod schemas, CRUD interceptors, and database adapters function exactly as they will in production.
2. **Total Isolation:** To prevent parallel tests from colliding, the helpers generate a **unique database name** for every test file (e.g., `mesh_test_a8f9c2`). 
3. **Clean Teardown:** Tests must rigorously clean up after themselves by destroying the app instance and dropping the temporary database.

## Prerequisites

Your test runner (e.g., Jest) needs access to a MongoDB connection string. Ensure you have a `.env` file in your project root, or set the environment variable directly before running tests:

```bash
MONGODB_URI="mongodb://localhost:27017"
```

## The `TestHelpers` API

The core testing utilities are exported from `mesh`.

- `createTestApp(options)`: Boots a complete `MeshApp` instance. It automatically wires up the Registry, Broker, and Database modules, generates a unique test database, and allows you to inject your custom modules. Returns `{ app, dbName }`.
- `destroyTestApp(app)`: Safely stops the mesh node and disconnects the database client.
- `dropTestDatabase(dbName, mongoUri?)`: Connects to MongoDB and drops the specified database.

---

## Example: Writing a Jest Test Suite

Here is a complete example of how to test a custom Mesh service (e.g., `MyService`) using Jest.

```typescript
import { 
    IServiceBroker,
    createTestApp, 
    destroyTestApp, 
    dropTestDatabase 
} from 'mesh';
import { MyService } from '../src/my.service.ts'; // Your service module

describe('MyService Integration Tests', () => {
    let app;
    let broker: IServiceBroker;
    let testDbName: string;

    // 1. Setup Phase
    beforeAll(async () => {
        // createTestApp generates a unique DB and wires up the core modules
        const setup = await createTestApp({
            nodeID: 'test-runner-node',
            modules: [new MyService()] // Inject the service you want to test
        });
        
        app = setup.app;
        testDbName = setup.dbName;
        broker = app.getProvider<IServiceBroker>('broker');
    });

    // 2. Teardown Phase
    afterAll(async () => {
        // Crucial: Stop the app and drop the isolated database
        await destroyTestApp(app);
        await dropTestDatabase(testDbName);
    });

    // 3. Testing Tool Calls
    describe('Tool Execution', () => {
        it('should successfully execute a tool call via the broker', async () => {
            // Use broker.call just like another node would
            const result = await broker.call('my_domain.do_something', { 
                input: 'test data' 
            });
            
            expect(result).toBeDefined();
            expect(result.success).toBe(true);
        });
    });

    // 4. Testing Persistence (CRUD)
    describe('Database Persistence', () => {
        it('should create and retrieve a document', async () => {
            // Test the automated CRUD pipeline
            const created = await broker.call('my_domain.create', { 
                name: 'Test Item', 
                value: 42 
            });
            
            expect(created.id).toBeDefined();

            const fetched = await broker.call('my_domain.get', { 
                id: created.id 
            });
            
            expect(fetched.name).toBe('Test Item');
            expect(fetched.value).toBe(42);
        });
    });
});
```

## Tips for Reliable Tests

1. **Never mock the Broker for integration tests:** `createTestApp` provides a real `ServiceBroker`. Always test your service by making calls through the broker (`broker.call(...)`) rather than calling methods on your service class directly. This ensures all middleware and Zod validations are executed.
2. **Type Safety:** If you want strict typing in your tests (to avoid `as any`), use TypeScript declaration merging to augment the `IServiceToolRegistry` within your test file, just as the code generator does for production code.
3. **Eventual Consistency:** If you are testing against a remote MongoDB cluster (like Atlas), remember that database writes can occasionally experience minor latency. If you perform a `find` or `count` immediately after a `create` loop, consider adding a tiny delay (e.g., 50-100ms) to ensure the data is visible.
```