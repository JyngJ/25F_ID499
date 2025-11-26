# PillowMate 학습 스크립트(train_model.py) 해설

이 문서는 `ActionRecognitionModule/python/train_model.py`가 어떤 순서로 데이터를 다루고 모델을 학습하는지를 누구나 이해할 수 있도록 정리한 가이드입니다. 코드를 직접 읽지 않아도 전체 흐름을 파악하고, 필요한 경우 자신에게 맞게 수정할 수 있습니다.

## 1. 입력 데이터 구조

- **경로**: 기본적으로 `ActionRecognitionModule/data/raw/*.csv`
- **형식**: `node/collect_data.js`가 만든 CSV 파일
- **컬럼**  
  - `timestamp_ms`: 샘플이 측정된 시각 (밀리초)  
  - `pressure`: 베개 압력센서 값에서 baseline을 뺀 결과 (= ΔP)  
  - `ax, ay, az`: 가속도계 (중력 포함)  
  - `gx, gy, gz`: 자이로(각속도)  
  - `label`: 사람이 입력한 동작 이름 (`idle`, `tap`, `hug` 등)

스크립트는 지정된 디렉터리의 CSV를 모두 읽어 하나의 표(DataFrame)로 합칩니다. 파일마다 라벨이 섞여 있어도 상관없습니다.

## 2. 피처/라벨 분리

1. 사용할 특징 열만 추립니다: `pressure`, `ax`, `ay`, `az`, `gx`, `gy`, `gz`.
2. `label` 열만 별도로 분리해 정답 벡터로 사용합니다.
3. 필요한 열이 빠져 있으면 즉시 오류를 내어 잘못된 데이터를 알려 줍니다.

## 3. 전처리

### 3.1 표준화(Standardization)

- `StandardScaler`를 이용해 각 피처의 평균을 0, 표준편차를 1로 맞춥니다.
- 이유: Johnny-Five 센서 값은 단위와 범위가 제각각이므로, 같은 스케일로 맞춰야 로지스틱 회귀가 제대로 학습됩니다.
- 나중에 실시간 추론 시에도 같은 평균/표준편차를 쓰기 때문에 `feature_mean`, `feature_scale`로 JSON에 저장합니다.

### 3.2 라벨 인코딩

- `LabelEncoder`가 문자열 라벨(`"idle"`, `"tap"`, ...)을 정수(`0, 1, 2, ...`)로 변환합니다.
- 모델 가중치를 계산하고 JSON으로 내보낼 때 다시 문자열 순서(`encoder.classes_`)를 저장하므로, 추론 시에도 동일한 라벨 순서가 보장됩니다.

## 4. 학습/검증 분리

- `train_test_split`으로 학습:검증 데이터를 기본 80:20 비율로 나눕니다.  
- `stratify=y` 옵션을 사용해 각 라벨 비율이 train/test 모두에서 비슷하게 유지되도록 합니다.  
- `random_state` 파라미터(기본 42)를 고정하면 실행할 때마다 같은 분할이 만들어져 재현성을 확보합니다.

## 5. 모델: 다중 클래스 로지스틱 회귀

- `LogisticRegression`을 `multi_class="multinomial"` + `solver="lbfgs"` 설정으로 사용합니다.
- 최대 반복 횟수는 1000 (`max_iter=1000`)로 여유 있게 잡았습니다.
- 이 모델은 입력 피처를 선형 결합한 후 softmax를 적용해 라벨별 확률을 출력합니다. 가볍고 Johnny-Five에서 바로 계산할 수 있는 형태입니다.

### 5.1 로지스틱 회귀(Logistic Regression)란?

- **개념**: 선형 회귀가 “숫자 예측”이라면, 로지스틱 회귀는 “이 입력이 A일까 B일까?”처럼 **범주를 구분**합니다. 입력 벡터 `x`에 대해 가중치 `w`와 편향 `b`를 곱해서 `w·x + b`를 계산한 뒤, 시그모이드(또는 다중 클래스에서는 소프트맥스) 함수를 거쳐 0~1 사이 확률을 얻습니다.
- **이 프로젝트에서의 의미**  
  1. 7차원 센서 벡터(압력+IMU)를 먼저 표준화해 스케일을 맞춥니다.  
  2. 각 라벨마다 고유한 가중치 벡터 `w_label`과 편향 `b_label`을 학습합니다.  
  3. 실시간 추론 시 `logit_label = w_label · x + b_label`을 구하고, 모든 라벨의 logit에 softmax를 적용해 확률을 얻습니다.  
  4. 가장 높은 확률을 가진 라벨이 현재 동작으로 선택됩니다.
- **왜 적합한가?**  
  - 파라미터 수가 적어 노이즈가 많은 센서 입력에도 빠르게 반응합니다.  
  - Johnny-Five 측에서 동일한 계산을 직접 구현할 수 있어(행렬 곱 + softmax) 추가 러닝 프레임워크가 필요 없습니다.  
  - 라벨이 늘어나도 선형 모델이므로 학습/추론 비용이 비교적 작습니다.

## 6. 평가 지표

- 학습 후 검증 세트(`X_test`, `y_test`)로 예측 값을 만들어 `classification_report`와 `confusion_matrix`를 출력합니다.
- 보고서에는 Precision / Recall / F1-score / Support가 포함되어 각 라벨이 얼마나 잘 맞았는지 확인할 수 있습니다.
- 혼동행렬은 어느 라벨이 다른 라벨로 잘못 분류되는지 파악할 때 유용합니다.

## 7. JSON 내보내기

`models/model_params.json`에는 다음 값이 저장됩니다.

| 키 | 설명 |
| --- | --- |
| `labels` | 라벨 이름 배열 (`["idle","tap",...]`) |
| `weights` | 각 라벨에 대한 가중치 행렬 (라벨 수 × 7 피처) |
| `bias` | 각 라벨의 편향 값 |
| `feature_mean` | 표준화에 사용된 평균 (7개) |
| `feature_scale` | 표준화에 사용된 표준편차 (7개) |
| `metadata` | CLI 평가 리포트 텍스트 및 혼동행렬 |

`run_inference.js`는 이 JSON을 읽어 같은 방식으로 표준화 → 선형 결합 → softmax를 적용해 실시간 확률을 계산합니다.

## 8. 실행 방법 요약

```bash
cd ActionRecognitionModule/python
python train_model.py \
  --data-dir ../data/raw \
  --json-out ../models/model_params.json \
  --test-size 0.2 \
  --random-state 42
```

대부분의 경우 기본값 그대로 두면 됩니다. 새로운 CSV를 추가했을 때 동일한 명령을 다시 실행하면 최신 데이터로 모델이 갱신됩니다.

## 9. 자주 하는 커스터마이징

- **테스트 비율 조정**: 데이터가 적을수록 `--test-size`를 0.1 이하로 줄여 더 많은 샘플을 학습에 쓰거나, 반대로 충분히 많다면 0.3 정도로 늘려도 됩니다.
- **재현성을 위한 시드**: 여러 명이 동일한 실험을 반복할 예정이면 `--random-state`를 공유하세요.
- **다른 알고리즘으로 교체**: 만약 더 복잡한 모델이 필요하면 `train_model.py`에서 `LogisticRegression` 부분만 다른 scikit-learn 분류기로 교체하면 됩니다. 다만 `run_inference.js`가 JSON 구조(선형 모델)를 가정하고 있으니, 추론 로직도 같이 수정해야 합니다.

## 10. 문제 해결 팁

- **CSV 없음 오류**: `data/raw`에 파일이 없으면 스크립트가 즉시 종료합니다. `node/collect_data.js`로 최소 한 번 이상 수집했는지 확인하세요.
- **학습이 수렴하지 않음**: 센서 값 스케일이 극端하거나 라벨 균형이 크게 깨져 있으면 경고가 뜰 수 있습니다. idle/행동 데이터 비율을 맞추고, 필요하면 `max_iter`를 더 늘립니다.
- **특정 라벨만 인식됨**: 수집 데이터가 편향되어 있거나 idle이 부족한 경우가 많습니다. `collect_data.js`에서 각 라벨을 동일한 횟수, 비슷한 강도로 반복해 주세요.

이 문서를 참고하면 PillowMate 행동 인식 모델이 어떤 원리로 학습되고 추론되는지, 그리고 어느 지점을 조정해야 원하는 결과를 얻을 수 있는지 쉽게 이해할 수 있습니다.
