#!/bin/bash
aws s3 cp s3://runningheatmapbycharlie.com/splits/18951387471.json /tmp/check_splits.json --region ap-southeast-2
python3 -c "
import json
d = json.load(open('/tmp/check_splits.json'))
print('Has streams key:', 'streams' in d)
if d.get('streams'):
    print('Stream keys:', list(d['streams'].keys()))
    print('velocity_smooth points:', len(d['streams'].get('velocity_smooth', [])))
else:
    print('Streams is null/missing - streams were not fetched')
"
