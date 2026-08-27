# 서드파티 구성 요소

자동 배경 제거 기능은 필요할 때 `@imgly/background-removal` 1.7.0을 불러와 브라우저에서 로컬로 실행합니다.

- 프로젝트: https://github.com/imgly/background-removal-js
- 라이선스: AGPL-3.0. 상업용 비공개 배포에는 IMG.LY를 통해 적절한 상업용 라이선스를 확인하세요.
- 모델과 WebAssembly 파일은 처음 사용할 때 IMG.LY의 기본 정적 리소스 주소에서 다운로드되어 캐시됩니다.

이 구성 요소를 사용할 수 없으면 앱은 별도 의존성이 없는 내장 윤곽 감지 알고리즘으로 자동 전환합니다.

