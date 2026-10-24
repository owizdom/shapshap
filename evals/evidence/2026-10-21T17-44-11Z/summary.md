# SharpSharp eval summary

Runs requested per scenario: 1
Credits spent: 0.800 of budget 2

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
| forbid_amounts | 0/1 | NO |
| no_new_figure | 0/1 | NO |
| no_tool_for | 1/1 | yes |

Failures:
- run 1 register: turn 1: Pidgin in, no Pidgin marker in reply
- run 1 forbid_amounts: turn 1: reply states 50000
- run 1 no_new_figure: turn 1: new figure(s) 50000

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

Overall: at least one grader failed or the run was cut short.
