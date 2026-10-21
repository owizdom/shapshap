# Mapping what customers say to fault keys

Send only these keys to value_trade_in. The labels are what the shop calls them.

| Key | Meaning |
|---|---|
| no_charge | Does not charge (charging port or charging IC) |
| no_power | Does not turn on |
| screen_cracked | Screen cracked but works |
| screen_dead | Screen black or not responding |
| face_id | Face ID not working |
| battery_service | Battery health below 80% or Service |
| back_glass | Back glass cracked |
| camera | Camera fault |
| speaker_mic | Speaker or microphone fault |

A phone with no faults gets an empty list. One problem can need more than one key, and a customer can list several. The same key twice counts once.

## What customers say

no_charge
- "e no dey charge", "no dey charge", "charging no dey work", "I plug am e no gree enter", "charger no dey hold", "e no dey take light"

no_power
- "it won't come on", "e no dey come on", "e don dead", "e no dey on at all", "no power", "stuck and no start"

screen_cracked
- "the screen don crack", "screen scatter but e dey work", "cracked screen", "glass broken but touch dey work"

screen_dead
- "screen black but I hear sound", "display no dey show", "touch no dey respond", "screen dey flicker and dead", "lines dey show then black"

face_id
- "Face ID no work", "face unlock no dey", "e dey ask passcode only", "Face ID unavailable"

battery_service
- "battery dey drain fast", "e show Service for battery", "battery health 78", "battery don weak"
- Only when the customer says the health is below 80 or the phone shows Service. If they just say it drains a bit and give no number, ask: "You know the battery health number? Settings, Battery, Battery Health."

back_glass
- "back don crack", "back glass broken", "back scatter"

camera
- "camera blur", "camera no dey open", "camera black", "camera shaky"

speaker_mic
- "people no dey hear me", "mic no work", "speaker no dey sound", "sound no dey come out", "call voice low"

## When the words are not enough

Ask one short question, then stop and wait.

- "It is not working" or "e spoil": "Which one, e no dey come on or e no dey charge?"
- "The screen is bad" with no detail: "Cracked but e still dey work, or e black?"
- "It won't come on" with a charging story ("I charged it all night and it won't come on"): both no_charge and no_power can be true. Ask: "When you plug the charger, any sign of charging?" If they say nothing happens and it will not turn on, use no_power. Do not add no_charge on top unless they say the port or charging is also faulty.
- Water damage: this is not a fault we have a key for. Do not pick the nearest key. Say a water-damaged phone cannot be valued here and ask what else is wrong that we can value. If it is the only problem, say we cannot value it in chat.
- A fault that is not in the table (for example a button, or a cellular signal fault): do not squeeze it into a key. Tell the customer the chat cannot value that fault, and the shop will look at it at pickup inspection if you go ahead with what you can value.

Do not ask more than one question per message. Do not ask about faults they have not mentioned and that you cannot guess; a plain "Anything else wrong with am?" once is enough if the picture seems incomplete.

If value_trade_in returns UNKNOWN_FAULT, you sent a key not in this table. Fix the key and try again; do not show the customer the error.

Do not tell the customer the percentages. Show the naira deduction from the tool result.
