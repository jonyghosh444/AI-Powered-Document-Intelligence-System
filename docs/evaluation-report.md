# Evaluation report

Provider: `fixture`. Embedding backend for this run: `hash`.
The labeled set is synthetic. Each file uses the same invoice template so the fixture extractor can be scored without a paid model.
Set `EXTRACTION_PROVIDER=gemini` and `GEMINI_API_KEY` before rerunning `npm run eval` to measure the free Gemini tier. This report records the provider that actually ran.

- Documents: 15
- Success rate: 93.3% (14 processed, including records flagged for review)
- Failure rate: 6.7% (1 file the pipeline rejected)
- Field accuracy on processed documents: 100.0% (140/140 fields and line amounts)
- Mean processing time: 0.212s
- Wall time: 3.915s

| Case | Result | Status | Expected | Seconds | Fields |
| --- | --- | --- | --- | --- | --- |
| clean-pdf-1 | ok | completed | completed | 0.003 | 10/10 |
| clean-pdf-2 | ok | completed | completed | 0.004 | 10/10 |
| clean-pdf-3 | ok | completed | completed | 0.003 | 10/10 |
| clean-csv | ok | completed | completed | 0.003 | 10/10 |
| clean-xlsx | ok | completed | completed | 0.007 | 10/10 |
| clean-xls | ok | completed | completed | 0.011 | 10/10 |
| clean-image | ok | completed | completed | 1.579 | 10/10 |
| missing-supplier | ok | needs_review | needs_review | 0.002 | 10/10 |
| bad-total | ok | needs_review | needs_review | 0.005 | 10/10 |
| duplicate-pdf | ok | needs_review | needs_review | 0.002 | 10/10 |
| cross-xlsx | ok | needs_review | needs_review | 0.008 | 10/10 |
| second-image | ok | completed | completed | 1.537 | 10/10 |
| clean-pdf-4 | ok | completed | completed | 0.004 | 10/10 |
| clean-csv-2 | ok | completed | completed | 0.005 | 10/10 |
| corrupt-pdf | failed | failed | failed | 0.000 | 0/0 |

