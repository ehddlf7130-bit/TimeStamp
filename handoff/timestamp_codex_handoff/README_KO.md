# 타임스탬프 템플릿 — Codex 인계 패키지

사진에 날짜·시간을 임의로 지정하면서, 사용자가 제공한 타임스탬프 앱의 출력 디자인을 재현하기 위한 **추출 리소스와 분석 자료**입니다. 완성된 앱이나 동적 날짜 렌더러는 포함하지 않습니다.

## 시작하기

1. ZIP을 풀고 해당 폴더를 Codex 작업 폴더로 엽니다.
2. `CODEX_HANDOFF_KO.md`를 읽게 합니다.
3. `CODEX_START_PROMPT_KO.md` 내용을 Codex에 전달합니다.
4. 대표 PNG는 `assets/canonical/`, 전체 로고는 `assets/logo.png`에 있습니다.
5. `metadata/manifest.json`을 기준으로 파일과 원본 좌표를 읽습니다. 파일명을 추측하지 마세요.

## 구성

| 경로 | 내용 |
| --- | --- |
| `CONVERSATION_SUMMARY_KO.md` | 지금까지의 요구사항, 대화에서 확인한 사실과 결정되지 않은 사항 |
| `CODEX_HANDOFF_KO.md` | 구현 방향, 좌표 체계, 제약과 검증 기준 |
| `CODEX_START_PROMPT_KO.md` | 바로 붙여 넣을 Codex 시작 프롬프트 |
| `assets/logo.png` | TIME STAMP 글자와 시계·소인 그림을 함께 추출한 투명 PNG |
| `assets/canonical/` | 날짜용 숫자·한글·괄호, 시간용 숫자·한글·콜론, 오전/오후 및 요일 토큰 |
| `assets/atlas.png` | 대표 리소스를 원래 픽셀 크기로 모은 스프라이트 시트 |
| `metadata/atlas.json` | 스프라이트 시트의 자산별 사각형. rect는 `[x,y,width,height]` |
| `assets/occurrences/` | 샘플별 모든 출현 글자·토큰. 같은 글자의 미세한 렌더링 차이 비교용 |
| `metadata/occurrences.json` | 모든 출현 리소스의 원본 좌표와 라벨 |
| `assets/line_specimens/` | 날짜 줄과 시간 줄 전체를 분리한 고정 문구 이미지 |
| `assets/logo_specimens/` | 샘플 8장 각각의 로고 추출본 |
| `assets/reference_overlays/` | 샘플별 전체 3240px 투명 오버레이. 날짜·시간은 고정되어 있음 |
| `sources/calibration/` | 검정 배경 원본 JPEG 8장. 압축을 다시 하지 않고 복사 |
| `sources/photo_references/` | 최초 제공한 실제 사진 5장. 배치·외관 비교용 |
| `previews/` | 원본 스탬프와 추출 리소스 확인용 이미지 |
| `scripts/extract_assets.py` | 원본에서 리소스를 다시 추출하는 Python 스크립트 |
| `scripts/verify_assets.py` | 라벨 범위, PNG, 원본 해시, 배치 재조립·밝기 검증 |
| `metadata/validation.json` | 이번 추출의 수치 검증 결과 |

## 중요한 한계

- 검정 배경의 밝기를 흰색 전경의 알파값으로 해석했습니다. **원본 알파를 직접 확보한 것이 아닙니다.**
- 검정 배경에서는 전경의 원래 색과 투명도를 따로 알아낼 수 없고, 검정 그림자도 관찰할 수 없습니다.
- JPEG 압축 흔적과 글자의 위치에 따른 미세한 변형이 남아 있습니다.
- 원본 폰트, 글자 진행 폭(advance), 베이스라인, 커닝은 아직 확인되지 않았습니다. JSON의 해당 항목은 `null`입니다.
- 샘플 원래 위치에 다시 조립하는 검증과, 임의 날짜를 새로 조합하는 검증은 다릅니다. 후자는 Codex에서 진행해야 합니다.
- 제품 플랫폼은 아직 정하지 않았습니다. 대화 중 웹페이지를 제안했지만 사용자가 선택하지 않았습니다.

## 재추출 및 검증

Python과 Pillow, NumPy가 필요합니다.

```bash
python -m pip install -r requirements.txt
python scripts/verify_assets.py
python scripts/extract_assets.py
python scripts/verify_assets.py
```

검증 출력의 `PASS`는 패키지 리소스와 고정 샘플 재조립에 대한 결과입니다. 임의 날짜의 픽셀 일치나 밝은 배경에서의 동일성을 의미하지 않습니다.

## 고정 오버레이를 합성하는 최소 예시

```python
from PIL import Image

photo = Image.open('your_square_photo.jpg').convert('RGBA')
overlay = Image.open('assets/reference_overlays/mon.png')
overlay = overlay.resize(photo.size, Image.Resampling.LANCZOS)
Image.alpha_composite(photo, overlay).convert('RGB').save('result.jpg', quality=95)
```

이 예시는 날짜가 고정된 샘플 합성입니다. 원본 사진은 정사각형이어야 하며, 다른 비율을 다루는 자르기 정책은 따로 구현해야 합니다.
