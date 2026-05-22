use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub tools: Option<Vec<String>>,
    /// Source directory the agent was loaded from.
    #[serde(skip)]
    pub source: PathBuf,
    /// Optional namespace inferred from a `plugin-name:agent-name` slug.
    #[serde(skip)]
    pub namespace: Option<String>,
}

pub struct AgentRegistry {
    by_name: BTreeMap<String, Agent>,
}

impl AgentRegistry {
    /// Scan in order — later paths override earlier ones on name collision.
    /// Typical call: `scan(&[user_dir, project_dir])`.
    pub fn scan(paths: &[PathBuf]) -> Self {
        let mut by_name = BTreeMap::new();
        for path in paths {
            let Ok(entries) = std::fs::read_dir(path) else {
                continue;
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("md") {
                    continue;
                }
                if let Some(agent) = parse_agent_file(&p) {
                    by_name.insert(agent.name.clone(), agent);
                }
            }
        }
        Self { by_name }
    }

    pub fn agents(&self) -> Vec<&Agent> {
        self.by_name.values().collect()
    }

    pub fn get(&self, name: &str) -> Option<&Agent> {
        self.by_name.get(name)
    }
}

fn parse_agent_file(path: &Path) -> Option<Agent> {
    let raw = std::fs::read_to_string(path).ok()?;
    let rest = raw.strip_prefix("---")?;
    let end = rest.find("\n---")?;
    let frontmatter = &rest[..end];

    let mut name = None::<String>;
    let mut description = String::new();
    let mut model = None;
    for line in frontmatter.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim();
            let v = v.trim();
            match k {
                "name" => name = Some(v.to_string()),
                "description" => description = v.to_string(),
                "model" => model = Some(v.to_string()),
                _ => {}
            }
        }
    }

    let name = name?;
    let namespace = name.split_once(':').map(|(ns, _)| ns.to_string());
    Some(Agent {
        name,
        description,
        model,
        tools: None,
        source: path.parent().unwrap_or(Path::new("")).to_path_buf(),
        namespace,
    })
}
