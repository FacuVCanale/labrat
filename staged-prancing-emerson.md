# PRD: Labrat

## Context

Hoy, investigadores e ingenieros que quieren explorar sistemáticamente un espacio de soluciones (entrenar modelos ML, optimizar algoritmos, comparar configuraciones, benchmarkear enfoques) enfrentan un loop manual doloroso: hipótesis → modificar código → correr experimento → esperar → interpretar → decidir → repetir. Es cognitivamente caro, lento, e imposible de sostener mientras dormís.

Dos proyectos resolvieron mitades adyacentes de este problema:

- **AutoResearch de Karpathy**: resuelve el loop de experimentación (modificar → correr → evaluar → keep/discard → repetir), pero es estrecho: un solo archivo, una sola métrica, sin crash recovery, sin planificación estructurada, sin tracking de costos.
- **GSD-2**: resuelve el workflow autónomo estructurado (state machine, crash recovery, fresh context per task, cost tracking, timeout supervision), pero está construido para *shipping software*, no para experimentación iterativa donde la mayoría de los intentos fallan.

**Labrat** combina ambos: planificación estructurada de investigación + loop de experimentación autónomo con keep/discard + infraestructura robusta de ejecución.

---

## 1. Visión

**"Corré overnight, despertate con descubrimientos."**

Labrat convierte al AI de una herramienta interactiva en un colaborador de investigación que trabaja mientras dormís. Tomás tu pregunta de investigación y criterios de evaluación, planifica una exploración sistemática, ejecuta experimentos time-boxed de forma autónoma, guarda lo que funciona, descarta lo que no, y produce un log estructurado de investigación.

**La diferencia fundamental**: investigación ≠ desarrollo. En desarrollo, avanzás linealmente hacia un objetivo conocido. En investigación, explorás un espacio donde la mayoría de los intentos fallan, y el valor está en el conocimiento acumulado sobre qué funciona y qué no. El producto está construido alrededor del loop keep/discard, no del loop plan/execute/ship.

---

## 2. Usuarios Target

| Persona | Descripción | Caso de uso |
|---------|------------|-------------|
| **ML Researcher** | Entrena modelos, explora hiperparámetros y arquitecturas | "Corré 100 experimentos de training overnight, guardá las mejoras" |
| **Performance Engineer** | Optimiza servicios backend | "Compará 6 estrategias de caching midiendo latencia p50/p95 y memoria" |
| **Algorithm Designer** | Diseña y compara estructuras de datos/algoritmos | "Benchmarkeá 4 implementaciones de sorting en 3 workloads distintos" |
| **Full-Stack Experimenter** | Explora preguntas de arquitectura de software | "SSR vs CSR: medí Lighthouse score, bundle size y load time" |

**NO es para**: quienes quieren shippear features (usar GSD-2), generar código one-shot (usar un LLM directo), o manejar un backlog de desarrollo.

---

## 3. User Journeys

### Journey 1: Loop de Experimentación Rápido (modo AutoResearch)
1. Usuario tiene proyecto con código y scripts de evaluación listos
2. Corre: `labrat start --target train.py --eval "python eval.py" --metric val_bpb --direction lower`
3. Sistema establece baseline corriendo eval sin cambios
4. Loop: modificar archivo(s) target → commit → correr eval → comparar métrica → keep si mejoró, revert si no → repetir
5. Usuario vuelve y encuentra log con N experimentos, M mejoras, mejor resultado actual

### Journey 2: Campaña de Investigación Estructurada
1. Usuario tiene pregunta de investigación amplia: "Cuál es la mejor estrategia de caching para nuestro API?"
2. Corre: `labrat plan` → flujo de discusión
3. Describe: pregunta, criterios de evaluación (latency p50/p95, memoria, hit rate), dimensiones a explorar (Redis vs Memcached vs in-memory, TTL strategies, invalidation patterns)
4. Sistema crea **Research Agenda** (análogo al Roadmap de GSD): campaña, dimensiones, experimentos planificados, evaluación, baseline
5. Corre: `labrat auto` → ejecución autónoma
6. Cada experimento: fresh context → leer plan + resultados previos → implementar variante → correr eval → registrar → keep/revert → actualizar log
7. Al completar la agenda, reassess: ¿hay follow-ups sugeridos por los resultados?
8. Usuario se despierta con **Research Report**: tabla rankeada, análisis de tendencias, recomendaciones

### Journey 3: Recovery Después de Crash
1. Sistema estaba en experimento 7 de 12 y la máquina se reinició
2. Usuario corre: `labrat auto`
3. Detecta crash lock, lee estado, revierte experimento incompleto, resume desde estado limpio
4. Sin intervención manual

### Journey 4: Morning Report
1. Corrió 40 experimentos overnight
2. `labrat report` muestra:
   - 40 experiments / 7 kept / 33 reverted
   - Best: experiment #23 (val_bpb: 1.412, -3.2% vs baseline)
   - Trayectoria de mejora acumulativa
   - Costo: $4.23 / 2.1M tokens
   - Tiempo: 6h 42m
   - Top 5 experimentos rankeados
   - Dimensiones exploradas vs pendientes

### Journey 5: Steering en Runtime
1. Terminal 1: Labrat corriendo
2. Terminal 2: `labrat discuss`
3. "Los experimentos de Redis están dando resultados similares. Skippeá los Redis restantes y focalizá en in-memory con diferentes eviction policies"
4. En el siguiente boundary de experimento, el sistema ajusta la agenda

---

## 4. Requerimientos de Producto

### P0 - Must Have (MVP)

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| R1 | **Loop de experimentación general** | Funciona para cualquier dominio: usuario especifica archivo(s) target, comando de eval, métrica(s) y dirección. Loop: modify → commit → eval → compare → keep/revert → repeat |
| R2 | **Framework de evaluación** | Comando de eval definido por usuario (cualquier shell command con output parseable). Múltiples métricas simultáneas. Dirección configurable (min/max). Scoring compuesto (pesos definidos por usuario). Hard timeout configurable (default 5 min) |
| R3 | **Fresh context por experimento** | Cada experimento tiene contexto LLM limpio. El prompt incluye: pregunta de investigación, mejores resultados actuales, historia comprimida de intentos previos, qué probar siguiente |
| R4 | **Git-based state management** | Branch por campaña de investigación. Cada experimento es un commit atómico. Experimentos fallidos se revierten limpiamente. Mejoras se acumulan en el branch |
| R5 | **Experiment log** | Log estructurado (JSON) de cada experimento: ID, timestamp, descripción del cambio, métricas before/after, decisión keep/revert, costo, duración. Queryable y sorteable. Sobrevive crashes |
| R6 | **Crash recovery** | Lock file trackea experimento actual. On restart: detectar interrupción, revertir cambios incompletos, resumir desde estado limpio. Sin intervención manual |
| R7 | **Cost & token tracking** | Costo por experimento. Total acumulado por campaña. Budget ceiling: pausar antes de exceder límite del usuario |
| R8 | **Timeout supervision** | Timeout por experimento y por evaluación (configurables). Idle detection (agente sin progreso) |
| R9 | **CLI básico** | `start` (loop rápido), `auto` (modo autónomo), `stop` (parada graceful), `status` (progreso), `report` (resumen) |

### P1 - Should Have (Post-MVP)

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| R10 | **Research agenda planning** | Flujo de discusión para capturar pregunta, dimensiones, criterios. Descomposición automática en experimentos planificados. Reassessment después de batches |
| R11 | **Simplicity-aware keep/discard** | Más allá de la métrica, considerar complejidad del código. Preferir soluciones simples sobre mejoras marginales (criterio de Karpathy). Peso configurable |
| R12 | **Multi-file experiments** | Experimentos pueden modificar múltiples archivos. Scope de modificación especificado por campaña |
| R13 | **Dependency & sequencing** | Algunos experimentos dependen de otros. Soporte para fases secuenciales dentro de una campaña |
| R14 | **Report generation** | Morning report estructurado: executive summary, tabla rankeada, trayectoria de mejora, cost breakdown, dimensiones sin explorar, recomendaciones |
| R15 | **Steering en runtime** | Comando `discuss` para guiar durante ejecución. Repriorizar experimentos, agregar ideas nuevas al queue |

### P2 - Nice to Have (Futuro)

| ID | Requerimiento | Descripción |
|----|--------------|-------------|
| R16 | **Templates por dominio** | Templates pre-armados: ML training, API benchmarking, algorithm comparison, config tuning |
| R17 | **Tree-based exploration** | En vez de secuencia lineal, exploración en árbol. Experimentos prometedores auto-generan sub-experimentos |
| R18 | **Statistical analysis** | Tests de significancia, confidence intervals, detección de métricas ruidosas |
| R19 | **Notificaciones** | Slack/Discord cuando la campaña completa o llega al budget ceiling |
| R20 | **Visualización** | Charts en terminal para trayectorias de métricas. Export a HTML para compartir |
| R21 | **Reproducibilidad** | Environment exacto capturado por experimento. "Reproduce experiment #23" |

---

## 5. Decisiones de Producto Clave

### D1: Jerarquía de trabajo
- **AutoResearch**: plano (experimento tras experimento)
- **GSD**: tres niveles (Milestone → Slice → Task)
- **Recomendación**: dos niveles para MVP. **Campaign** (pregunta + criterios) contiene **Experiments**. Post-MVP, agregar **Phase** entre ellos para agendas estructuradas (R10)

### D2: Cómo decide el agente qué probar
- **Recomendación**: híbrido. El agente decide *qué modificar* (parte creativa). El sistema controla *cuándo correr, cómo evaluar, si keep/discard* (parte mecánica). MVP soporta "free exploration" (sin agenda, solo mejorar la métrica) y "guided" (con agenda)

### D3: Evaluación single vs multi-metric
- **Recomendación**: multi-metric desde día uno. Comando de eval produce JSON con métricas nombradas. Usuario especifica pesos y direcciones. Esencial para uso general

### D4: Métricas no-determinísticas
- **Recomendación**: flag `--runs N` en el eval command. Sistema corre eval N veces y usa la mediana. Default N=1

### D5: Scope de modificación
- **Recomendación**: usuario especifica archivo(s) target al inicio de la campaña. Agente puede modificar cualquiera de los targets pero no archivos fuera del set (safety boundary). Eval script e infraestructura son inmutables

### D6: Experimentos que rompen cosas
- **Recomendación**: eval que crashea = experimento fallido, auto-revert. Log registra "eval_crashed". Después de 3 crashes consecutivos, pausar y alertar al usuario

---

## 6. Métricas de Éxito

| Categoría | Métrica | Target |
|-----------|---------|--------|
| **Productividad** | Experimentos por noche (8h) | 50+ (experimentos cortos ML) / 10+ (evals largos) |
| **Confiabilidad** | Tasa de recovery automático | 95%+ |
| **Descubrimiento** | Tasa de mejoras encontradas | >= random search baseline |
| **Time to value** | Del `start` al primer resultado | < 5 minutos |
| **Usabilidad** | Tiempo para entender morning report | < 2 minutos |
| **Eficiencia** | Overhead de costo (context mgmt vs eval) | < 15% del total |
| **Calidad** | False positives en keep (guardó algo peor) | 0% |
| **Onboarding** | Install → primer experimento | < 15 minutos |

---

## 7. Punto de Partida y Estrategia de Repo

**Decisión: repo nuevo `labrat` basado en GSD-2, con upstream tracking.**

### Setup del repo

El usuario ya tiene un fork de GSD-2 para contribuir al proyecto original. Para Labrat, se crea un **repo nuevo independiente**:

1. `git clone https://github.com/gsd-build/gsd-2.git labrat`
2. `cd labrat && rm -rf .git && git init`
3. `git remote add upstream https://github.com/gsd-build/gsd-2.git`
4. Push a nuevo repo `labrat` en GitHub
5. README debe atribuir a GSD-2 como base

**Para pullear fixes de GSD-2 upstream**: `git fetch upstream` + cherry-pick selectivo de commits relevantes (infraestructura, bug fixes). No merge directo porque las abstracciones van a divergir rápido.

**LLM providers**: se mantiene el soporte multi-provider que viene de GSD-2. Si hay que simplificar algo, default a Claude.

### Rationale

Los problemas difíciles de ingeniería son de **infraestructura**, no de lógica de experimentación:
- Fresh context por unidad de trabajo ✅ GSD-2 lo tiene
- Crash recovery con lock files y forensics ✅ GSD-2 lo tiene
- Cost/token tracking por unidad ✅ GSD-2 lo tiene
- Timeout supervision (soft/idle/hard) ✅ GSD-2 lo tiene
- State machine disk-based ✅ GSD-2 lo tiene
- Git branch management ✅ GSD-2 lo tiene
- CLI con modos interactivo y autónomo ✅ GSD-2 lo tiene
- Soporte multi-provider (20+ LLMs) ✅ GSD-2 lo tiene
- Stuck detection ✅ GSD-2 lo tiene

AutoResearch contribuye el **concepto de producto** (loop keep/discard, eval por métrica, criterio de simplicidad, filosofía "never stop"), no infraestructura. Son ideas que se traducen a:
- Un state machine phase diferente: `Plan → Modify → Evaluate → Keep/Discard → Repeat`
- Un tipo de unidad distinto: `run-experiment` en vez de `execute-task`
- Prompt templates para experimentos en vez de features
- Un evaluation runner (código nuevo: correr comando, parsear output, comparar métricas)
- Mecanismo keep/discard (código nuevo: comparar métricas, git revert on failure)

### Qué adaptar de GSD-2
- **State machine** (`auto.ts`): de fases de desarrollo a fases de experimentación
- **State derivation** (`state.ts`): de milestone/slice/task a campaign/experiment
- **Types** (`types.ts`): `Campaign`, `Experiment`, `ExperimentResult`, `MetricDefinition`, `EvaluationConfig`
- **Prompts** (`prompts/`): reemplazar 20+ templates de desarrollo por equivalentes de investigación
- **Git strategy**: de branch-per-slice con squash merge a branch-per-campaign con commits que se acumulan (kept) o reviertan (discarded)

### Qué mantener de GSD-2 casi sin cambios
- Crash recovery, session forensics
- Cost/token tracking, budget ceiling
- Timeout supervision, idle detection
- CLI framework, preferences
- Multi-provider LLM support
- Extension system
- Doctor/health checks

### Riesgo principal
Las abstracciones de GSD-2 están profundamente orientadas a desarrollo de software. El refactor a abstracciones de investigación es significativo. Pero es preferible a reconstruir toda la infraestructura desde cero.

---

## 8. Verificación

Una vez implementado con GSD, validar:
1. **Loop básico funciona**: `labrat start` con un proyecto simple de Python (ej: optimizar una función de sorting) ejecuta el loop modify → eval → keep/discard correctamente
2. **Multi-metric**: eval produce JSON con 2+ métricas, scoring compuesto funciona
3. **Crash recovery**: matar el proceso mid-experiment, reiniciar, verificar que resume limpiamente
4. **Cost tracking**: verificar que el report muestra costo por experimento y total
5. **Morning report**: después de 10+ experimentos, `labrat report` produce resumen útil y legible
6. **ML use case end-to-end**: correr el caso de uso original de Karpathy (train.py + val_bpb) como smoke test de compatibilidad
7. **Upstream sync**: verificar que cherry-pick de un fix de GSD-2 upstream funciona sin conflictos en la capa de infraestructura
