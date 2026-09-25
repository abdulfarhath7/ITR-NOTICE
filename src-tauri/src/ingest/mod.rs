//! The ingestion service (docs/05, docs/06). `source` is the seam every
//! engine sits behind; `portal_source` drives the Playwright sidecar;
//! `eri_source` compiles and reports NotConfigured; `runner` is the
//! sequential, attended, resumable queue.

pub mod eri_source;
pub mod portal_source;
pub mod decide;
pub mod runner;
pub mod scheduler;
pub mod source;
pub mod state;

#[cfg(test)]
mod tests;
