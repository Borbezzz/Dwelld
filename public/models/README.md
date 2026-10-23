# Browser detection model

`yolo11n.onnx` is exported from the official Ultralytics YOLO11n pretrained COCO80 checkpoint:
https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo11n.pt

Exported with Ultralytics 8.4.184, Python 3.10, Torch 2.14.1, ONNX 1.23.2, opset 17:

```python
from ultralytics import YOLO
YOLO('yolo11n.pt').export(format='onnx', imgsz=640, opset=17, simplify=True, dynamic=False, nms=False)
```

Input `images`: float RGB NCHW `[1,3,640,640]`, values 0–1. Output `output0`: `[1,84,8400]`, center x/y/width/height and 80 class scores. The client letterboxes frames with value 114, reverses that transform, filters supported room classes and applies class-aware NMS. Boxes stored by the application use normalized top-left x/y/width/height in the original full frame.

SHA-256: `32743404af6bb165ed2405c507114247e5e484b9a91307987cb57d564de7b598`.

Upstream model license: AGPL-3.0 (included in `ULTRALYTICS-LICENSE.txt`), or separately obtained Ultralytics Enterprise terms. This notice does not change the application repository's license. Review upstream terms before distributing a proprietary application incorporating this model: https://www.ultralytics.com/license

Model docs: https://docs.ultralytics.com/models/yolo11/
Export docs: https://docs.ultralytics.com/integrations/onnx/

The model and ONNX Runtime WASM are served from this application's static assets. Python/PyTorch were used only for this one-time model export; production detection executes in the browser without a GPU server or inference API key.

## Real browser verification

On 23 October 2026, the actual browser WASM helper was run against the COCO kitchen image `val2017/000000397133.jpg` (https://s3.amazonaws.com/images.cocodataset.org/val2017/000000397133.jpg). It returned two oven detections with model scores approximately 0.69946 and 0.64999. This verifies real inference and supported appliance output; it is not a model accuracy benchmark or a damage-analysis test. Furniture verification uses the separate COCO furnished-room image `val2017/000000000139.jpg` (https://s3.amazonaws.com/images.cocodataset.org/val2017/000000000139.jpg); the actual browser WASM helper returned seven detections: two chairs (0.860509, 0.641219), two TVs (0.936932, 0.548547), one potted plant (0.643385), one vase (0.634733), and one clock (0.571372). The visible dining table was missed, and one of the TV detections may be a false positive; not every visible object was detected. These are raw model scores and observations from this single image, not a calibrated accuracy measurement.
