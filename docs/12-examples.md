# Floe — Examples

All examples are canonical (formatted) and have `error`-free diagnostics.

## Minimal
```floe
A -> B
```

## Auth Flow
```floe
direction LR
User [person] "End User"
API [service] "API Gateway"
Database [database]

User -> API : request
API -> Database : query
Database -> API : result
API -> User : response
```

## With Labels
```floe
Login -> Dashboard : success
Login -> Error : invalid credentials
A -- B : associated
X -> Y : "quoted label"
```

## Chaining, Fan-in, Fan-out
```floe
A -> B -> C
API -> Worker, Cache : fan-out
User, Admin -> Login
```

## Named Edges + Styles
```floe
E1: Gateway -> Cache : warm
note E1 "warms on deploy"
link E1 "https://api.example.com/cache"
meta Gateway.fill = "#dbeafe"
```

## Node Types
```floe
User [person]
API [service]
Database [database]
Cache [service]
Worker [worker]
Client [client]
```

## Groups (nesting)
```floe
group Backend {
  API [service]
  Database [database]
  API -> Database : query
}
group Frontend [subsystem] "Frontend Services" {
  group Auth {
    Login
    Login -> Dashboard
  }
  User [person] "End User"
}
```

## Direction
```floe
direction TB
A -> B
B -> C
```
Variants: `TB`, `BT`, `LR`, `RL` — case-sensitive.

## Metadata & Annotations & Links
```floe
meta author = "Alice"
meta version = "1.0"
group Backend {
  meta owner = "platform"
  API [service]
}
note "Global diagram note"
note API "Handles authentication"
link API "https://api.example.com"
link Backend "https://docs.example.com/backend"
```

## Complete Diagram (canonical)
```floe
direction LR
// Mixed valid file covering all v0.1 features

// explicit node types
User [person]
API [service]
Database [database]

// edges with and without labels
User -> API
API -> Database : query
API -> Cache : miss
Database -> API : result

Cache [service]
API -> API : self-loop
```

See `corpus/basic/*`, `corpus/groups/*`, `corpus/metadata/*`, `corpus/edge-cases/*` for more and `examples/` for runnable files (`hello`, `auth-flow`, `groups`, `metadata`, `edge-cases`, `decision-tree`, `microservices`, `showcase-v1-1`, `styled`).
