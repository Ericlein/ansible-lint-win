use zed_extension_api::{self as zed, Result};

struct AnsibleLiteExtension;

impl zed::Extension for AnsibleLiteExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let node = zed::node_binary_path()
            .or_else(|_| Ok::<String, String>("node".to_string()))
            .unwrap();

        Ok(zed::Command {
            command: node,
            args: vec![
                "C:\\Users\\Eric\\Desktop\\ansible-lint\\windows-ansible-lint\\server\\dist\\server.js".to_string(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(AnsibleLiteExtension);
