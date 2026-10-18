---
"@secondlayer/shared": minor
"@secondlayer/api": minor
"@secondlayer/web": patch
---

CLI sign-in takes an optional `product: "sentinel"`. It is stored on the attempt (new nullable `cli_device_logins.product` column, a closed set), and the approval page then names Sentinel, says to run `sentinel logout`, warns to approve only a code you started, and shows the machine name as unchecked text from the device. Any other product value is refused. Without a product the page reads as before.
