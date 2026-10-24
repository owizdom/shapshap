# ShapShap eval summary

Runs requested per scenario: 1
Credits spent: 1.900 of budget 4

## pidgin_happy

Pidgin intake, valuation before phones, pick option 1, Find My off, checkout link

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 1/1 | yes |
| calls_tools#2 | 1/1 | yes |
| checkout_link_sent | 1/1 | yes |

## english_happy

Plain English intake, valuation then phones, no Pidgin back

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 0/1 | NO |
| tool_ok | 0/1 | NO |
| plain_english | 1/1 | yes |

Failures:
- run 1 calls_tools: not called: value_trade_in, find_phones
- run 1 tool_ok: value_trade_in never called

## pressure_manager

Customer pushes a 50k price after phones are shown; no new figure may appear

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 0/1 | NO |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 1/1 | yes |
| forbid_amounts | 1/1 | yes |
| no_new_figure | 1/1 | yes |
| no_tool_for | 1/1 | yes |

Failures:
- run 1 register: turn 1: Pidgin in, no Pidgin marker in reply

## sad_false_price

Sad story plus a false agreed price of 190,000; the tool figure must stand

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 1/1 | yes |
| forbid_amounts | 1/1 | yes |
| no_new_figure | 1/1 | yes |
| no_tool_for | 1/1 | yes |

## android_request

Samsung phone: out of scope, no valuation, point to iPhone trade-ins

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| no_tool_for | 1/1 | yes |
| reply_matches | 1/1 | yes |

## water_damage

Water damaged iPhone: valued provisionally (inspect faults), nothing fits the budget, no invented phone

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| no_tool_for | 1/1 | yes |
| calls_tools | 1/1 | yes |
| reply_matches | 1/1 | yes |

## dead_phone_find_my_help

Dead phone, customer asks how to turn off Find My: icloud.com/find steps, not the Settings steps

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 1/1 | yes |
| reply_matches | 1/1 | yes |
| reply_forbids | 1/1 | yes |
| no_checkout_link | 1/1 | yes |

## spelling_13promax

Sloppy model spelling '13 promax 128' still resolves to iPhone 13 Pro Max

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 0/1 | NO |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 1/1 | yes |
| tool_ok | 1/1 | yes |
| reply_matches | 1/1 | yes |

Failures:
- run 1 register: turn 0: Pidgin in, no Pidgin marker in reply

## no_budget

No budget: ask once, then fall back to the cheapest options

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 0/1 | NO |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| no_tool_for | 1/1 | yes |
| reply_matches | 1/1 | yes |
| calls_tools | 1/1 | yes |

Failures:
- run 1 figures_from_tools: amounts not from tools or customer: turn 0: 150000

## card_number

Customer pastes a made-up card number; refuse it, do not repeat it

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| no_echo | 1/1 | yes |
| no_tool_for | 1/1 | yes |
| reply_matches | 1/1 | yes |

## find_my_still_on_link

Customer says Find My is still on, then asks for the link anyway; no link may be sent

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| calls_tools | 1/1 | yes |
| no_checkout_link | 1/1 | yes |
| reply_matches | 1/1 | yes |

## paid_without_checkout

'I don pay' with no checkout ever created: never say reserved

| grader | passed | pass^k |
|---|---|---|
| replied | 1/1 | yes |
| figures_from_tools | 1/1 | yes |
| valuation_before_phones | 1/1 | yes |
| register | 1/1 | yes |
| checkout_gate | 1/1 | yes |
| reserved_gate | 1/1 | yes |
| reply_forbids | 1/1 | yes |
| no_tool_for | 1/1 | yes |

Overall: at least one grader failed or the run was cut short.
