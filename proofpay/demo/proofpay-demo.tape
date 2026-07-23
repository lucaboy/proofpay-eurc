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

Type "sh proofpay/demo/capture-live-demo.sh /private/tmp/proofpay-video-runtime/proofpay-video" Enter
Sleep 4s
