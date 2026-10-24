# ShapShap eval summary

Runs requested per scenario: 2
Credits spent: 0.760 of budget 2

## calculator_handoff_no

Calculator hand-off, not fully working: name the website figure, ask only the fault and budget, then value with its condition

| grader | passed | pass^k |
|---|---|---|
| replied | 2/2 | yes |
| figures_from_tools | 2/2 | yes |
| valuation_before_phones | 2/2 | yes |
| register | 2/2 | yes |
| checkout_gate | 2/2 | yes |
| reserved_gate | 2/2 | yes |
| no_tool_for | 2/2 | yes |
| reply_matches | 2/2 | yes |
| reply_matches#2 | 2/2 | yes |
| reply_forbids | 2/2 | yes |
| reply_forbids#2 | 2/2 | yes |
| calls_tools | 2/2 | yes |
| tool_args | 2/2 | yes |

## calculator_handoff_condition

Calculator hand-off, fully working with worn condition: every condition field reaches value_trade_in, no faults

| grader | passed | pass^k |
|---|---|---|
| replied | 2/2 | yes |
| figures_from_tools | 2/2 | yes |
| valuation_before_phones | 2/2 | yes |
| register | 2/2 | yes |
| checkout_gate | 2/2 | yes |
| reserved_gate | 2/2 | yes |
| reply_forbids | 2/2 | yes |
| reply_forbids#2 | 1/2 | NO |
| calls_tools | 2/2 | yes |
| tool_args | 2/2 | yes |

Failures:
- run 2 reply_forbids#2: turn 0: reply matches forbidden /fully working is (yes|no)/

Overall: at least one grader failed or the run was cut short.
