use zed_extension_api::{self as zed, Result};

const SERVER_PKG: &str = "ansible-ls-lite";
const SERVER_PATH: &str = "node_modules/ansible-ls-lite/dist/server.js";

struct AnsibleLiteExtension {
    installed: bool,
}

impl zed::Extension for AnsibleLiteExtension {
    fn new() -> Self {
        Self { installed: false }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let server_path = self.ensure_server_installed(language_server_id)?;
        let node = zed::node_binary_path()?;

        Ok(zed::Command {
            command: node,
            args: vec![server_path, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

impl AnsibleLiteExtension {
    fn ensure_server_installed(&mut self, language_server_id: &zed::LanguageServerId) -> Result<String> {
        let installed_version = zed::npm_package_installed_version(SERVER_PKG).ok().flatten();
        let latest_version = zed::npm_package_latest_version(SERVER_PKG)?;

        if installed_version.as_deref() != Some(&latest_version) || !self.installed {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );

            zed::npm_install_package(SERVER_PKG, &latest_version)?;

            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::None,
            );
        }

        self.installed = true;
        Ok(SERVER_PATH.to_string())
    }
}

zed::register_extension!(AnsibleLiteExtension);
