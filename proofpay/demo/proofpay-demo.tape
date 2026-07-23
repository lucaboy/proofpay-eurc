Output "/private/tmp/proofpay-eurc-demo.mp4"

Require sh
Require node
Require npm
Require git
Require expect

Set Shell "zsh"
Set FontSize 15
Set FontFamily "JetBrains Mono"
Set Width 1400
Set Height 820
Set Padding 16
Set Framerate 30
Set PlaybackSpeed 1.35
Set TypingSpeed 12ms
Set Theme "Catppuccin Mocha"
Set WindowBar "Colorful"
Set WindowBarSize 34

Type "env PATH=\"$PROOFPAY_NODE_BIN_DIR:$PATH\" PROOFPAY_DEVNET_PAYER_SCRIPT=\"$PROOFPAY_DEVNET_PAYER_SCRIPT\" PROOFPAY_ZEROCLAW_BIN=\"$PROOFPAY_ZEROCLAW_BIN\" sh proofpay/demo/capture-live-demo.sh \"$PROOFPAY_VIDEO_RUNTIME\"" Enter
Sleep 180s
