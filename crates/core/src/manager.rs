use crate::caffeinate::CaffeinateCtl;
use crate::error::SessionError;
use crate::session::{Session, SessionConfig};
use parking_lot::RwLock;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use uuid::Uuid;

pub struct SessionManager {
    sessions: RwLock<HashMap<Uuid, Arc<Session>>>,
    caffeinate: Arc<CaffeinateCtl>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self::new_with_caffeinate_binary("/usr/bin/caffeinate".into())
    }

    pub fn new_with_caffeinate_binary(binary: PathBuf) -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            caffeinate: Arc::new(CaffeinateCtl::new_with_binary(
                binary.to_str().unwrap_or("/usr/bin/caffeinate"),
            )),
        }
    }

    pub async fn spawn(&self, cfg: SessionConfig) -> Result<Arc<Session>, SessionError> {
        let session = Session::spawn_with(cfg, Some(self.caffeinate.clone())).await?;
        self.sessions.write().insert(session.id, session.clone());
        Ok(session)
    }

    pub async fn close(&self, id: Uuid) -> Result<(), SessionError> {
        self.sessions.write().remove(&id);
        Ok(())
    }

    pub fn get(&self, id: Uuid) -> Option<Arc<Session>> {
        self.sessions.read().get(&id).cloned()
    }

    pub fn list(&self) -> Vec<Arc<Session>> {
        self.sessions.read().values().cloned().collect()
    }

    pub fn caffeinate_refcount(&self) -> usize {
        self.caffeinate.refcount()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}
