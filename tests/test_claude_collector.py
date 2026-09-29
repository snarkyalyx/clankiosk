import importlib.util
import json
import pathlib
import tempfile
import unittest


PATH = pathlib.Path(__file__).resolve().parents[1] / 'electron/claude_collector.py'
SPEC = importlib.util.spec_from_file_location('claude_collector', PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


class ClaudeCollectorTest(unittest.TestCase):
    def test_otlp_deduplicates_and_promotes_transcript_row(self):
        attributes = lambda fields: [{'key': key, 'value': {'stringValue': str(v)}} for key, v in fields.items()]
        payload = {'resourceLogs': [{'resource': {'attributes': attributes({'session.id': 'session-a'})},
            'scopeLogs': [{'logRecords': [
                {'body': {'stringValue': 'claude_code.api_request'}, 'attributes': attributes({
                    'model': 'claude-opus-5-5', 'client_request_id': 'request-a',
                    'event.timestamp': '2026-09-29T12:00:00Z', 'input_tokens': 10,
                    'cache_creation_tokens': 20, 'cache_read_tokens': 30,
                    'output_tokens': 4, 'cost_usd': '0.01',
                })},
                {'body': {'stringValue': 'claude_code.user_prompt'}, 'attributes': attributes({'content': 'private'})},
            ]}]}]}
        rows = collector.parse_otlp(payload, 'linux')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['request_key'], 'client:request-a')
        self.assertEqual(sum(rows[0][key] for key in ('input_tokens','cache_creation_tokens','cache_read_tokens','output_tokens')), 64)
        self.assertNotIn('content', rows[0])
        with tempfile.TemporaryDirectory() as tmp:
            db = collector.db_connect(pathlib.Path(tmp) / 'usage.sqlite')
            try:
                self.assertEqual(collector.insert_rows(db, rows), 1)
                self.assertEqual(collector.insert_rows(db, rows), 0)
                transcript = {**rows[0], 'priority': 1, 'output_tokens': 100, 'cost_usd': None}
                self.assertEqual(collector.insert_rows(db, [transcript]), 0)
                self.assertEqual(db.execute('SELECT output_tokens FROM requests').fetchone()[0], 4)
            finally:
                db.close()

    def test_transcript_uses_final_usage_for_one_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            previous_root = collector.ROOT
            collector.ROOT = pathlib.Path(tmp)
            try:
                folder = collector.ROOT / '.claude/projects/sample'
                folder.mkdir(parents=True)
                with (folder / 'session-a.jsonl').open('w') as stream:
                    for output in (2, 8):
                        stream.write(json.dumps({
                            'type':'assistant','timestamp':'2099-09-29T12:00:00Z',
                            'sessionId':'session-a','requestId':'request-a',
                            'message':{'id':'message-a','model':'claude-opus-5-5',
                                'usage':{'input_tokens':10,'cache_creation_input_tokens':20,
                                         'cache_read_input_tokens':30,'output_tokens':output}},
                        }) + '\n')
                rows = list(collector.transcript_rows())
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]['output_tokens'], 8)
                self.assertEqual(rows[0]['request_key'], 'client:request-a')
            finally:
                collector.ROOT = previous_root


if __name__ == '__main__':
    unittest.main()
