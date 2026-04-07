import mongoose from 'mongoose';
import Lobby from '../../models/Lobby';
import { LobbyService } from '../lobbyService';
import { WebSocketService } from '../websocketService';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid'),
}));

jest.mock('../../models/Lobby', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock('../websocketService', () => ({
  WebSocketService: {
    emitToGameRoom: jest.fn(),
  },
}));

describe('LobbyService.continueToRoleSelection', () => {
  const mockedLobby = Lobby as jest.Mocked<typeof Lobby>;
  const leaderId = new mongoose.Types.ObjectId();
  const secondPlayerId = new mongoose.Types.ObjectId();
  const thirdPlayerId = new mongoose.Types.ObjectId();

  const createLobbyDoc = () => ({
    sessionId: 'session-123',
    stage: 'waiting-room',
    leader: leaderId,
    maxPlayers: 3,
    status: 'waiting',
    players: [
      {
        userId: leaderId,
        name: 'Leader',
        selectedRole: null,
      },
      {
        userId: secondPlayerId,
        name: 'Player 2',
        selectedRole: null,
      },
      {
        userId: thirdPlayerId,
        name: 'Player 3',
        selectedRole: null,
      },
    ],
    save: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the leader to continue only when the room is full', async () => {
    const lobbyDoc = createLobbyDoc();
    mockedLobby.findOne.mockResolvedValue(lobbyDoc as any);

    const getLobbyStateSpy = jest.spyOn(LobbyService, 'getLobbyState').mockResolvedValue({
      sessionId: 'session-123',
      lobbyCode: 'ABC123',
      leader: leaderId.toString(),
      gameMode: 'waste',
      stage: 'role-selection',
      players: [
        {
          userId: leaderId.toString(),
          name: 'Leader',
          selectedRole: null,
          joinedAt: new Date(),
        },
        {
          userId: secondPlayerId.toString(),
          name: 'Player 2',
          selectedRole: null,
          joinedAt: new Date(),
        },
        {
          userId: thirdPlayerId.toString(),
          name: 'Player 3',
          selectedRole: null,
          joinedAt: new Date(),
        },
      ],
      status: 'waiting',
      createdAt: new Date(),
      maxPlayers: 3,
    });

    const result = await LobbyService.continueToRoleSelection(
      'session-123',
      leaderId.toString()
    );

    expect(lobbyDoc.stage).toBe('role-selection');
    expect(lobbyDoc.save).toHaveBeenCalledTimes(1);
    expect(WebSocketService.emitToGameRoom).toHaveBeenCalledWith(
      'session-123',
      'lobby-state-update',
      expect.objectContaining({
        reason: 'role-selection-entered',
      })
    );
    expect(result.stage).toBe('role-selection');

    getLobbyStateSpy.mockRestore();
  });

  it('rejects non-leaders', async () => {
    mockedLobby.findOne.mockResolvedValue(createLobbyDoc() as any);

    await expect(
      LobbyService.continueToRoleSelection('session-123', secondPlayerId.toString())
    ).rejects.toThrow('Only the group leader can continue');
  });

  it('rejects transitions when the room is not full', async () => {
    const lobbyDoc = createLobbyDoc();
    lobbyDoc.players = lobbyDoc.players.slice(0, 2);
    mockedLobby.findOne.mockResolvedValue(lobbyDoc as any);

    await expect(
      LobbyService.continueToRoleSelection('session-123', leaderId.toString())
    ).rejects.toThrow('Lobby must have exactly 3 joined players before continuing');
  });
});