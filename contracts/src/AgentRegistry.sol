// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AgentRegistry
 * @notice Arc Testnet — ERC-8004-inspired on-chain identity registry for autonomous agents.
 *
 * @dev Gives software agents a persistent, inspectable onchain identity:
 *      - Owners register agents with a name, type, and metadata URI.
 *      - Anyone may attest activity (volume + tx count) against an agent — permissionless
 *        in simulation-first mode, enabling reputation to accumulate from any caller.
 *      - A reputation score (0-100) is computed deterministically from txCount + totalVolume.
 *      - Agents can be suspended or deactivated by their owner.
 *
 * ERC-8004 reference: https://eips.ethereum.org/EIPS/eip-8004
 * Arc Testnet, Chain ID 5042002
 */
contract AgentRegistry {
    enum Status { Active, Suspended, Deactivated }

    struct Agent {
        address owner;          // wallet that registered this agent
        string  name;           // human-readable identifier (e.g. "TreasuryAgent-v2")
        string  agentType;      // "api-consumer" | "market-maker" | "data-provider" | "orchestrator" | "custom"
        string  metadataURI;    // IPFS or HTTPS URI pointing to full agent metadata JSON
        Status  status;
        uint256 registeredAt;
        uint256 totalVolume;    // cumulative USDC transacted, raw 6-decimal
        uint256 txCount;        // total number of recorded activities
    }

    mapping(uint256 => Agent) public agents;
    uint256 public nextId;

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed owner,
        string  name,
        string  agentType
    );
    event ActivityRecorded(
        uint256 indexed agentId,
        uint256 amount,
        uint256 newTotalVolume,
        uint256 newTxCount
    );
    event StatusChanged(uint256 indexed agentId, Status newStatus);
    event MetadataUpdated(uint256 indexed agentId, string metadataURI);

    // ─── Register ─────────────────────────────────────────────────────────────

    /**
     * @notice Register a new agent identity on-chain.
     *
     * @param name        Human-readable agent name (max 64 chars recommended).
     * @param agentType   Agent classification — see natspec above for accepted values.
     * @param metadataURI URI pointing to agent metadata (schema, capabilities, public key, etc).
     * @return agentId    Monotonically increasing ID; share with counterparties.
     */
    function registerAgent(
        string calldata name,
        string calldata agentType,
        string calldata metadataURI
    ) external returns (uint256 agentId) {
        require(bytes(name).length > 0,      "AgentRegistry: empty name");
        require(bytes(agentType).length > 0, "AgentRegistry: empty agentType");

        agentId = nextId++;
        agents[agentId] = Agent({
            owner:        msg.sender,
            name:         name,
            agentType:    agentType,
            metadataURI:  metadataURI,
            status:       Status.Active,
            registeredAt: block.timestamp,
            totalVolume:  0,
            txCount:      0
        });

        emit AgentRegistered(agentId, msg.sender, name, agentType);
    }

    // ─── Activity attestation ─────────────────────────────────────────────────

    /**
     * @notice Record an economic activity for an agent (permissionless attestation).
     *         Increments txCount and adds `amount` (raw 6-decimal USDC) to totalVolume.
     *
     * @dev Intentionally permissionless for simulation-first use. In production,
     *      restrict via `require(authorizedRecorders[msg.sender])` or similar.
     */
    function recordActivity(uint256 agentId, uint256 amount) external {
        Agent storage a = agents[agentId];
        require(a.owner != address(0),        "AgentRegistry: agent not found");
        require(a.status == Status.Active,    "AgentRegistry: agent not active");

        a.totalVolume += amount;
        a.txCount     += 1;

        emit ActivityRecorded(agentId, amount, a.totalVolume, a.txCount);
    }

    // ─── Owner controls ───────────────────────────────────────────────────────

    function updateMetadata(uint256 agentId, string calldata metadataURI) external {
        require(agents[agentId].owner == msg.sender, "AgentRegistry: not owner");
        agents[agentId].metadataURI = metadataURI;
        emit MetadataUpdated(agentId, metadataURI);
    }

    function setStatus(uint256 agentId, uint8 newStatus) external {
        require(agents[agentId].owner == msg.sender, "AgentRegistry: not owner");
        require(newStatus <= uint8(Status.Deactivated), "AgentRegistry: invalid status");
        agents[agentId].status = Status(newStatus);
        emit StatusChanged(agentId, Status(newStatus));
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getAgent(uint256 agentId) external view returns (Agent memory) {
        return agents[agentId];
    }

    /**
     * @notice Compute a 0-100 reputation score deterministically from on-chain history.
     *         score = min(100,  txCount × 5  +  totalVolume / 1e9  [per $1000 USDC])
     */
    function getReputationScore(uint256 agentId) external view returns (uint256) {
        Agent storage a = agents[agentId];
        if (a.owner == address(0)) return 0;
        uint256 txScore  = a.txCount * 5;
        uint256 volScore = a.totalVolume / 1_000_000_000; // +1 per $1000 USDC
        uint256 raw = txScore + volScore;
        return raw > 100 ? 100 : raw;
    }

    /**
     * @notice Validate that an agent is registered, active, and meets a minimum reputation.
     *         Useful as a guard in other contracts (e.g. spending limits, subscriptions).
     */
    function validate(uint256 agentId, uint256 minReputation) external view returns (bool) {
        Agent storage a = agents[agentId];
        if (a.owner == address(0))     return false;
        if (a.status != Status.Active) return false;
        uint256 score = this.getReputationScore(agentId);
        return score >= minReputation;
    }
}
