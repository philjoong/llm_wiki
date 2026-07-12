use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KnowledgeErrorCode {
    SchemaVersionMismatch,
    ValidationFailed,
    NotFound,
    CardinalityConflict,
    AtomicWriteRecoveryRequired,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeError {
    pub code: KnowledgeErrorCode,
    pub message: String,
}

impl KnowledgeError {
    pub fn new(code: KnowledgeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for KnowledgeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", serde_json::to_string(&self.code).unwrap_or_default(), self.message)
    }
}

impl std::error::Error for KnowledgeError {}
