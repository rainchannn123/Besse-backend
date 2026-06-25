# SKILLS.md — `src/routes`

## Directory Purpose
Declares HTTP route endpoints and middleware/controller wiring by domain.

## Files and Responsibilities

### `adminRoutes.ts`
- Admin endpoint definitions.
- Applies auth/admin middleware before admin controller handlers.

### `authRoutes.ts`
- Authentication and session/token related endpoints.

### `brokerRoutes.ts`
- Broker domain endpoint map.

### `gameRoutes.ts`
- Game lifecycle/action endpoint map.

### `lobbyRoutes.ts`
- Lobby creation/join/transition/state endpoints.

### `mrfRoutes.ts`
- MRF domain endpoint map.

### `municipalityRoutes.ts`
- Municipality domain endpoint map.

## Routing Standards
- Keep routes declarative; avoid logic beyond middleware composition.
- Apply middleware consistently for protected resources.
- Use feature-local controller handlers for clarity.
- Chatbot endpoints are added as a dedicated route file `chatbotRoutes.ts` with minimal request processing.

## Typical Change Flows
- Add endpoint:
  1. Define route + middleware chain here.
  2. Implement controller handler.
  3. Implement service logic.
  4. Update Swagger docs if applicable.
  5. If adding a new assistant feature, add a route under `chatbotRoutes.ts` and keep the contract small.

## Risks
- Missing middleware can create security gaps.
- Route path or HTTP verb mismatch can break frontend integration.
