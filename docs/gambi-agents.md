# Gambi Agents

This document records the future direction discussed for `gambi agents` and how it relates to the current Gambi product.

## What Gambi Is Today

Today, Gambi is the transport and coordination layer for sharing model endpoints through a room-scoped hub.

Current responsibilities:

- room lifecycle
- participant registration
- tunnel-backed connectivity between hub and participant
- OpenAI-compatible room inference endpoints
- operational events and baseline observability

The current project is intentionally narrow: it solves transport, routing, and operability for shared LLM endpoints.

## What Gambi Agents Could Become

`gambi agents` would sit one layer above the current hub. Instead of only sharing model endpoints, the system would support networks of agents that can be connected, discovered, orchestrated, and observed across heterogeneous providers and runtimes.

Potential characteristics:

- agents backed by different providers or local models
- agents contributed by different people
- shared rooms or networks for collaboration
- stronger identity, capability, and workload semantics than a plain LLM endpoint
- richer tracing and lineage across multi-agent work

In product terms, the current Gambi hub is the infrastructure substrate. `gambi agents` would be an orchestration layer above it.

## Relationship To The Current Plan

This vision does not change the current tunnel-first plan. It reinforces it.

Reasons:

- tunnel-first participation removes the requirement that an agent provider be publicly reachable on the network
- keeping `responses` as the default protocol aligns the current transport with the modern OpenAI-compatible surface that agent runtimes are moving toward
- baseline observability now creates the event and metric contract needed later for agent-level tracing
- keeping the hub narrowly focused avoids mixing orchestration concerns into the core transport too early

## What Should Stay Out Of Scope Now

The current project should not yet absorb:

- agent scheduling
- workflow graphs
- shared memory abstractions
- task delegation semantics
- multi-agent planning
- identity and trust models for agent-to-agent collaboration

Those belong to a future layer. If they are introduced too early, the current hub becomes harder to reason about and harder to keep compatible with plain OpenAI-compatible tools.

## Practical Guidance

Near-term decisions should preserve a clean path upward:

- keep the hub protocol and management plane explicit
- treat participants as transport endpoints, not as full agent runtimes
- keep observability request-centric and room-centric
- avoid direct-network assumptions between hub and participant
- prefer additive metadata that can later describe richer capabilities

## Short Product Thesis

Gambi today is a local-first shared inference fabric.

`gambi agents` could become the orchestration fabric built on top of that base.
