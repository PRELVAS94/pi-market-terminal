from kitty.fast_data_types import Screen,set_options
from kitty.options.types import defaults
import sys,json
class Callbacks:
 def __init__(self):self.replies=[]
 def write(self,data):self.replies.append(bytes(data).decode('ascii','replace'))
 def __getattr__(self,name):return lambda *args:None
set_options(defaults);c=Callbacks();s=Screen(c,48,160,100,10,20,0,c)
while True:
 data=sys.stdin.buffer.read1(65536)
 if not data:break
 data=memoryview(data)
 while data:
  dest=s.test_create_write_buffer();used=s.test_commit_write_buffer(data,dest);data=data[used:];s.test_parse_written_data()
 try:
  image=s.grman.image_for_client_id(2222)
  summary=None if image is None else {key:image[key] for key in ('width','height','refs.count')}
  if image is not None:
   summary['bytes']=len(image['data'])
   summary['nonzero']=any(image['data'][::65536])
 except Exception as e:summary={'error':str(e)}
 print(json.dumps({'replies':c.replies,'image':summary}),flush=True);c.replies=[]
