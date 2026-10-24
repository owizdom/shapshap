# ShapShap eval summary

Runs requested per scenario: 1
Credits spent: 0.920 of budget 1

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
| calls_tools | 1/1 | yes |
| tool_ok | 1/1 | yes |
| plain_english | 1/1 | yes |

## no_budget

No budget: ask once, then fall back to the cheapest options

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
| calls_tools | 1/1 | yes |

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

Overall: every grader passed on every run.
