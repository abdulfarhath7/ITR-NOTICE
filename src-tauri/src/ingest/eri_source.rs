//! `EriSource`: compiles, reports NotConfigured, does nothing (docs/06).
//! Live ERI work is blocked on the ITD-supplied UAT URL list, the
//! SERVICE_NAME string and the real client id / secret header names.
//! TODO(blocked): see NOTES.md, "ERI".

use crate::ingest::source::*;

pub struct EriSource;

impl NoticeSource for EriSource {
    fn login<'a>(&'a mut self, _login: &'a LoginRef, _password: &'a str, _sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<(), SourceError>> {
        Box::pin(async { Err(SourceError::NotConfigured("ERI is not configured for this firm".into())) })
    }
    fn list_work_items<'a>(&'a mut self, _module: Module, _panel: &'a str, _sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<PanelResult, SourceError>> {
        Box::pin(async { Err(SourceError::NotConfigured("ERI is not configured for this firm".into())) })
    }
    fn fetch_item<'a>(&'a mut self, _reference_id: &'a str, _sink: &'a mut dyn PanelSink)
        -> BoxFuture<'a, Result<Option<WorkItemDetail>, SourceError>> {
        Box::pin(async { Err(SourceError::NotConfigured("ERI is not configured for this firm".into())) })
    }
    fn logout<'a>(&'a mut self) -> BoxFuture<'a, ()> {
        Box::pin(async {})
    }
    fn health(&self) -> SourceHealth {
        SourceHealth::NotConfigured
    }
}
