use std::fs;
use zed_extension_api::{self as zed, Result};

struct AnsibleLiteExtension {
    server_path: Option<String>,
}

impl zed::Extension for AnsibleLiteExtension {
    fn new() -> Self {
        Self { server_path: None }
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // Look for bundled server.js in the extension directory
        let server_js = self.server_script_path(language_server_id)?;

        Ok(zed::Command {
            command: "node".to_string(),
            args: vec![server_js, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

impl AnsibleLiteExtension {
    fn server_script_path(
        &mut self,
        language_server_id: &zed::LanguageServerId,
    ) -> Result<String> {
        if let Some(ref path) = self.server_path {
            if fs::metadata(path).is_ok() {
                return Ok(path.clone());
            }
        }

        // Check for server.js bundled alongside the extension
        let bundled = "server/dist/server.js".to_string();
        if fs::metadata(&bundled).is_ok() {
            self.server_path = Some(bundled.clone());
            return Ok(bundled);
        }

        // Try downloading from GitHub releases
        let release = zed::latest_github_release(
            "yourusername/ansible-ls-lite",
            zed::GithubReleaseOptions {
                require_assets: true,
                pre_release: false,
            },
        )?;

        let asset_name = "ansible-ls-lite-server.tar.gz";
        let asset = release
            .assets
            .iter()
            .find(|a| a.name == asset_name)
            .ok_or_else(|| format!("No asset named {} in release", asset_name))?;

        let download_dir = "server";
        zed::download_file(
            &asset.download_url,
            &download_dir,
            zed::DownloadedFileType::GzipTar,
        )
        .map_err(|e| format!("Failed to download server: {e}"))?;

        let path = format!("{}/dist/server.js", download_dir);
        self.server_path = Some(path.clone());
        Ok(path)
    }
}

zed::register_extension!(AnsibleLiteExtension);
