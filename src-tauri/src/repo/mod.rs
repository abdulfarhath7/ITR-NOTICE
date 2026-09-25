//! All database access lives here (docs/13-conventions.md). Command handlers
//! call these functions and never hold SQL of their own.
//!
//! Writes to synced tables go through `rows::upsert` / `rows::delete`, the
//! one place that will also append the ledger entry (Phase 6). Reads are
//! explicit queries returning explicit DTOs.

pub mod cadence;
pub mod clients;
pub mod documents;
pub mod drafts;
pub mod local;
pub mod meta;
pub mod model;
pub mod modules;
pub mod proceedings;
pub mod queue;
pub mod registry;
pub mod rows;
pub mod runs;
pub mod scopes;
pub mod updates;
pub mod work_items;
