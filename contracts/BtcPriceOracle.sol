// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    IAgentRequester,
    IAgentRequesterHandler,
    Response,
    Request,
    ResponseStatus
} from "./Interfaces/IAgentRequester.sol";

interface IJsonApiAgent {
    function fetchUint(string calldata url, string calldata selector, uint8 decimals)
        external returns (uint256);
}

contract BtcPriceOracle is IAgentRequesterHandler {
    IAgentRequester public immutable platform;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant PRICE_PER_AGENT = 0.03 ether;

    uint256 public latestPrice;
    mapping(uint256 => bool) public pendingRequests;

    event PriceReceived(uint256 indexed requestId, uint256 price);

    constructor(address platform_) {
        platform = IAgentRequester(platform_);
    }

    function requestBitcoinPrice() external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );

        uint256 deposit = platform.getRequestDeposit()
                       + PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
        require(msg.value >= deposit, "Underfunded");

        requestId = platform.createRequest{value: deposit}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );
        pendingRequests[requestId] = true;
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external override {
        require(msg.sender == address(platform), "Only platform");
        require(pendingRequests[requestId], "Unknown request");
        delete pendingRequests[requestId];

        if (status == ResponseStatus.Success && responses.length > 0) {
            latestPrice = abi.decode(responses[0].result, (uint256));
            emit PriceReceived(requestId, latestPrice);
        }
    }

    receive() external payable {}
}