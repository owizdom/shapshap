# Faults: self-checks and phrasings

The key, what to ask the customer to check, and how people describe it. Send only these keys to value_trade_in.

## Power and charging

- **charging_port** (deduct): Charges only with wiggling or one cable; wireless charging works. Check: Try two cables and a wall socket; does wireless or MagSafe charging work?
- **charging_ic** (inspect): Does not charge with any cable or wirelessly. Check: 30 min on a wall socket with two cables, then force restart
- **no_power** (inspect): Does not turn on. Check: Charge one hour, then volume up, volume down, hold side button
- **boot_loop** (inspect): Stuck on Apple logo or restarts by itself. Check: Does it pass the Apple logo and reach the lock screen?

## Screen

- **screen_cracked** (deduct): Screen glass cracked but works. Check: Picture and touch work in every corner?
- **screen_dead** (deduct): Screen black or not responding to touch. Check: Does it ring or vibrate while the screen stays black?
- **display_lines** (deduct): Lines green line flicker or tint on screen. Check: Open a plain white page; any line or tint?
- **oled_burn_in** (deduct): Faint ghost image stays on screen. Check: Plain grey image at full brightness; any keyboard or bar outline?
- **touch_fault** (deduct): Ghost touch or dead touch area. Check: Drag a jiggling app icon to every corner; does it drop?

## Battery

- **battery_service** (deduct): Battery health below 80% or Service. Check: Settings > Battery > Battery Health > Maximum Capacity
- **battery_swollen** (inspect): Screen or back lifting from battery. Check: Does the screen lift at an edge or the phone rock on a table?

## Cameras and Face ID

- **face_id** (deduct): Face ID not working or not available. Check: Settings > Face ID & Passcode > Set Up Face ID
- **rear_camera** (deduct): Rear camera black blurry or shaking. Check: Open Camera; try every zoom; any black blur or buzzing?
- **front_camera** (deduct): Selfie camera black or blurry. Check: Switch to selfie camera and take a photo; then test Face ID
- **camera_lens_cracked** (deduct): Glass over rear camera cracked. Check: Look at the glass rings over the rear lenses
- **flashlight** (deduct): Flashlight does not work. Check: Control Center > Flashlight

## Body and buttons

- **back_glass** (deduct): Back glass cracked. Check: Any crack on the back, even small?
- **frame_dents** (deduct): Dents or deep scratches on metal frame. Check: Run a finger along the edges and corners
- **bent_housing** (inspect): Phone is bent. Check: Lay it screen-down on a flat table; does it rock?
- **buttons** (deduct): Power volume or Action/mute button fault. Check: Press each button; does the volume bar, lock or silent icon show?
- **converted_housing** (refuse): Model in Settings differs from the claim. Check: Settings > General > About: Model Name and Model Number

## Sound

- **loudspeaker** (deduct): Loudspeaker silent or crackling. Check: Settings > Sounds & Haptics; drag the ringtone slider
- **earpiece** (deduct): Cannot hear callers at the ear. Check: Make a call and hold it to the ear
- **microphone** (deduct): Callers cannot hear you. Check: Voice Memos: record and play back
- **vibration** (deduct): Phone does not vibrate. Check: Flip mute switch or press Action button; any buzz?

## Network

- **wifi_bluetooth** (inspect): Wi-Fi or Bluetooth greyed out. Check: Settings > Wi-Fi: switch grey after a restart?
- **no_service** (inspect): No Service or Searching with a working SIM. Check: Insert a working SIM; toggle Airplane Mode; is IMEI blank in About?
- **carrier_locked** (deduct): Locked to a foreign network. Check: Settings > General > About > Carrier Lock says No SIM restrictions?
- **esim_only** (deduct): eSIM only with no SIM tray. Check: Is there a SIM tray on the side?

## Liquid

- **liquid_damage** (inspect): Has entered water or liquid. Check: Any liquid-detected alert? Red indicator in SIM slot?

## Repair history (Settings, General, About, Parts and Service History)

- **aftermarket_screen** (deduct): Display shows Unknown or True Tone missing. Check: Settings > General > About > Parts and Service History; Settings > Display & Brightness > True Tone
- **battery_not_genuine** (deduct): Battery shows Unknown or Unable to verify. Check: Settings > Battery > Battery Health; Parts and Service History
- **battery_boosted** (inspect): Battery health reading may be faked. Check: Read cycle count and date of first use in Battery Health (iPhone 15 and later)
- **parts_unknown_other** (deduct): Camera or other part shows Unknown or Used. Check: Settings > General > About > Parts and Service History
- **logic_board_unverified** (inspect): Logic board shows Unverified. Check: Parts and Service History: Logic Board Unverified?
- **finish_repair_pending** (inspect): A part shows Finish Repair. Check: Parts and Service History: Finish Repair next to a part?

## Locks the shop cannot buy

- **icloud_locked** (refuse): Locked to another Apple Account. Check: After erase, does setup ask for someone else's Apple Account?
- **mdm_locked** (refuse): Company or school managed phone. Check: Settings > General > VPN & Device Management shows an organisation?
- **lost_or_blacklisted** (refuse): Marked lost or IMEI blocked. Check: Does the lock screen show a lost message?
- **passcode_unknown** (refuse): Seller cannot unlock or phone says Unavailable. Check: Can you unlock it and sign out of your Apple Account?
- **icloud_bypassed** (refuse): iCloud was bypassed. Check: Was it ever bypassed or unlocked by a shop?

## Common Pidgin and Nigerian English phrasings

- charging_port or charging_ic: "e no dey charge", "charging no dey work", "I plug am e no gree enter" (ask about wireless charging to tell them apart)
- no_power: "e don dead", "e no dey come on", "e no dey on at all"
- screen_cracked: "the screen don crack", "screen scatter but e dey work"; display_lines: "screen dey show line", "green line"
- screen_dead: "screen black but I hear sound", "display no dey show"; touch_fault: "the screen dey press itself"
- face_id: "Face ID no work", "no face id", "e dey ask passcode only"
- battery_service: "BH 79", "battery don show service"; battery_not_genuine: "battery dey show unknown part"
- aftermarket_screen: "changed screen", "screen no be original", "true tone no dey"
- no_service: "network no dey enter", "e dey search network"; carrier_locked: "e lock to UK network"; esim_only: "e no get SIM tray", "na eSIM only"
- liquid_damage: "e enter water"; icloud_locked: "iCloud dey on am", "e get iCloud"; mdm_locked: "e be company phone"

Water damage is liquid_damage (inspect). A fault that fits no key: say the chat cannot value it and the owner decides at pickup whether it changes the value. Do not tell the customer the percentages; show the naira from the tool result. If value_trade_in returns UNKNOWN_FAULT, fix the key and call again without showing the error.
