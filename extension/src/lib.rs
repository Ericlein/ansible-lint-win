use std::env;
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

        let cwd = env::current_dir()
            .map_err(|e| format!("failed to read extension working directory: {e}"))?;
        let server_path = cwd
            .join("node_modules")
            .join(SERVER_PACKAGE)
            .join("dist")
            .join("server.js");

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().into_owned(),
                "--stdio".to_string(),
            ],
            env: Default::default(),
        })
    }
}

zed::register_extension!(AnsibleLintWinExtension);
