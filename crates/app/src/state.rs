use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_true")]
    pub sidebar_visible: bool,
    #[serde(default = "default_true")]
    pub right_pane_visible: bool,
}

fn default_width() -> u32 {
    1400
}
fn default_height() -> u32 {
    900
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestSession {
    pub id: String,
    pub cwd: String,
    pub name: String,
    pub created: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct DirectoryConfig {
    #[serde(default)]
    pub run_command: String,
    #[serde(default)]
    pub test_command: String,
    #[serde(default)]
    pub build_command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub sessions: Vec<ManifestSession>,
    #[serde(default)]
    pub window: WindowState,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font_family")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default)]
    pub last_cwd: Option<String>,
    #[serde(default)]
    pub directories: HashMap<String, DirectoryConfig>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
}

fn default_theme() -> String {
    "dark".into()
}
fn default_font_family() -> String {
    "JetBrains Mono".into()
}
fn default_font_size() -> u32 {
    13
}

impl Default for Manifest {
    fn default() -> Self {
        Self {
            sessions: vec![],
            window: WindowState::default(),
            theme: default_theme(),
            font_family: default_font_family(),
            font_size: default_font_size(),
            last_cwd: None,
            directories: HashMap::new(),
            model: None,
            effort: None,
        }
    }
}

pub fn default_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("CCShell/state.json")
}

pub fn load_from(path: &Path) -> std::io::Result<Manifest> {
    if !path.exists() {
        return Ok(Manifest::default());
    }
    let s = std::fs::read_to_string(path)?;
    serde_json::from_str(&s).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

pub fn save_to(path: &Path, manifest: &Manifest) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(manifest)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(path, s)
}
