use zed_extension_api::{self as zed, Result};

const SERVER_PACKAGE: &str = "ansible-lint-win";

struct AnsibleLintWinExtension;

impl zed::Extension for AnsibleLintWinExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let installed = zed::npm_package_installed_version(SERVER_PACKAGE)?;
        let latest = zed::npm_package_latest_version(SERVER_PACKAGE)?;

        if installed.as_ref() != Some(&latest) {
            zed::npm_install_package(SERVER_PACKAGE, &latest)?;
        }

        let node = zed::node_binary_path()?;

        Ok(zed::Command {
            command: node,
            args: vec![
                format!("node_modules/{}/dist/server.js", SERVER_PACKAGE),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(AnsibleLintWinExtension);
