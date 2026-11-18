// Imported by UI tests. The frozen global setup (src/test/setup.ts) keeps Testing Library's
// 1 s default for findBy*; screens that load several queries need more on a busy CI runner.
import { configure } from '@testing-library/react';

configure({ asyncUtilTimeout: 4000 });
