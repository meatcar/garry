class Garry < Formula
  desc "Run gstack (garrytan/gstack) in full isolation from your local Claude Code config"
  homepage "https://github.com/meatcar/garry"
  url "https://github.com/meatcar/garry/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "" # filled in on release
  license "MIT"
  head "https://github.com/meatcar/garry.git", branch: "main"

  depends_on "bun"

  def install
    libexec.install "src"
    (bin/"garry").write <<~SH
      #!/bin/sh
      exec bun "#{libexec}/src/cli.ts" "$@"
    SH
  end

  test do
    output = shell_output("#{bin}/garry 2>&1")
    assert_match "Usage", output
  end
end
